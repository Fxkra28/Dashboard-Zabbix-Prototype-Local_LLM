import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * web/nginx.conf and the include it shares, read as nginx reads them.
 *
 * nginx cannot run where the tests do, so this is a small reader for the parts that matter: it
 * splits the file into directives and blocks, splices the `include` in, and checks what a mistake
 * here would cost. A wrong timeout is felt on a bad day, and a duplicate directive stops the web
 * container from starting at all.
 */
interface Node {
  name: string;
  args: string[];
  children?: Node[];
}

function tokens(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) i++;
    else if (c === '#') while (i < text.length && text[i] !== '\n') i++;
    else if (c === ';' || c === '{' || c === '}') out.push(text[i++]);
    else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      out.push(text.slice(i + 1, j));
      i = j + 1;
    } else {
      let j = i;
      while (j < text.length && !/[\s;{}]/.test(text[j])) j++;
      out.push(text.slice(i, j));
      i = j;
    }
  }
  return out;
}

function parse(text: string): Node[] {
  const list = tokens(text);
  let i = 0;
  const block = (): Node[] => {
    const out: Node[] = [];
    while (i < list.length && list[i] !== '}') {
      const words: string[] = [];
      while (i < list.length && ![';', '{', '}'].includes(list[i])) words.push(list[i++]);
      const end = list[i++];
      if (end === '{') out.push({ name: words[0], args: words.slice(1), children: block() });
      else if (end === ';') out.push({ name: words[0], args: words.slice(1) });
      else throw new Error(`a directive is missing its semicolon: ${words.join(' ')}`);
    }
    if (i < list.length) i++; // the closing brace
    return out;
  };
  const top = block();
  if (i < list.length) throw new Error('a closing brace has no opening one');
  return top;
}

const file = (name: string) => readFileSync(fileURLToPath(new URL(`../../../web/${name}`, import.meta.url)), 'utf8');

/** `include` replaced by the file's own directives; both Docker COPYs put the file at conf.d/bff-proxy.inc. */
function splice(nodes: Node[]): Node[] {
  return nodes.flatMap((n) => {
    if (n.name === 'include' && n.args[0] === '/etc/nginx/conf.d/bff-proxy.inc') return parse(file('bff-proxy.inc'));
    return [{ ...n, children: n.children && splice(n.children) }];
  });
}

const source = file('nginx.conf');
const apiSource = file('src/api/client.ts');
const configSource = readFileSync(fileURLToPath(new URL('../core/config.ts', import.meta.url)), 'utf8');
const conf = splice(parse(source));
const server = conf.find((n) => n.name === 'server') as Node;
const locations = (server.children ?? []).filter((n) => n.name === 'location');
const bff = locations.filter((l) => l.args.join(' ').includes('/bff/'));
const place = (l: Node) => l.args.join(' ');
const find = (nodes: Node[], name: string) => nodes.filter((n) => n.name === name);
const own = (l: Node, name: string) => find(l.children ?? [], name).at(-1)?.args[0];
const seconds = (v: string | undefined) => (v === undefined ? NaN : Number(/^(\d+)s$/.exec(v)?.[1]));

/** What a location ends up with: its own setting, else the server's, as nginx inherits it. */
const timeout = (l: Node) => seconds(own(l, 'proxy_read_timeout') ?? own(server, 'proxy_read_timeout'));
const buffering = (l: Node) => own(l, 'proxy_buffering') ?? own(server, 'proxy_buffering') ?? 'on';

describe('web/nginx.conf', () => {
  it('reads cleanly, with every /bff location in it', () => {
    expect(bff.map(place).sort()).toEqual(['/bff/', '/bff/api/explain/', '/bff/api/sli', '= /bff/api/chat', '= /bff/api/stream']);
  });

  it('listens on 8080, a port the non-root nginx image can bind (SC-21)', () => {
    // container-hardening.test.ts ties this to compose's port mapping, the Dockerfile and the healthcheck.
    expect(find(server.children ?? [], 'listen').map((n) => n.args.join(' '))).toEqual(['8080']);
  });

  it('names no outside host in the CSP, and index.html loads from none: the fonts are served from /fonts/ (IN-22)', () => {
    const csp = find(find(conf, 'map').find((n) => n.args[1] === '$csp')?.children ?? [], 'default')[0]?.args[0] ?? '';
    expect(csp, 'the CSP was found').toContain("default-src 'self'");
    const origins = (text: string) => [...new Set(text.match(/https?:\/\/[a-z0-9.-]+/g) ?? [])].sort();
    expect(origins(csp), 'the CSP names a host outside this site').toEqual([]);
    expect(csp).toContain("font-src 'self';");
    // Every tag that can fetch something: a stylesheet or preload <link>, and a <script>.
    const fetching = (file('index.html').match(/<(?:link|script)\b[^>]*>/g) ?? []).join('\n');
    expect(origins(fetching), 'index.html fetches from a host outside this site').toEqual([]);
  });

  it('serves /fonts/ itself, cached for a month and not for ever, with the four security headers', () => {
    const fonts = locations.find((l) => place(l) === '/fonts/');
    expect(fonts, 'a /fonts/ location').toBeDefined();
    const headers = find(fonts?.children ?? [], 'add_header');
    expect(headers.map((n) => n.args[0]).sort()).toEqual(
      ['Cache-Control', 'Content-Security-Policy', 'Referrer-Policy', 'X-Content-Type-Options', 'X-Frame-Options'],
    );
    // The names are not content-hashed, so a replaced font has to reach people within a month.
    const cache = headers.find((n) => n.args[0] === 'Cache-Control')?.args[1] ?? '';
    expect(cache).toBe('public, max-age=2592000');
    expect(own(fonts as Node, 'try_files')).toBe('$uri');
  });

  it('enforces the CSP in every location that sends headers, and names no report-only header (SC-24)', () => {
    const sending = locations.filter((l) => find(l.children ?? [], 'add_header').length > 0);
    expect(sending.map(place).sort()).toEqual(['/', '/assets/', '/fonts/', '~ ^/(?!bff/)(.*/)?\\.', '~* ^/logo(-mark|-icon|-white)?\\.png$']);
    for (const l of sending) {
      const names = find(l.children ?? [], 'add_header').map((n) => n.args[0]);
      expect(names, place(l)).toContain('Content-Security-Policy');
      expect(names.filter((n) => /report-only/i.test(n)), place(l)).toEqual([]);
      const csp = find(l.children ?? [], 'add_header').find((n) => n.args[0] === 'Content-Security-Policy');
      expect(csp?.args.slice(1), place(l)).toEqual(['$csp', 'always']);
    }
  });

  describe('the security headers on nginx’s own replies (IN-69)', () => {
    const HEADERS = ['Content-Security-Policy', 'Referrer-Policy', 'X-Content-Type-Options', 'X-Frame-Options'];

    it('sets all four at the server, with always, so a reply nginx makes itself (a 502, a 413, a 414, a 405) carries them', () => {
      const direct = find(server.children ?? [], 'add_header');
      expect(direct.map((n) => n.args[0]).sort()).toEqual(HEADERS);
      for (const h of direct) expect(h.args.at(-1), h.args[0]).toBe('always');
      expect(direct.find((n) => n.args[0] === 'Content-Security-Policy')?.args.slice(1)).toEqual(['$csp', 'always']);
      expect(direct.find((n) => n.args[0] === 'X-Frame-Options')?.args.slice(1)).toEqual(['SAMEORIGIN', 'always']);
      expect(direct.find((n) => n.args[0] === 'X-Content-Type-Options')?.args.slice(1)).toEqual(['nosniff', 'always']);
      expect(direct.find((n) => n.args[0] === 'Referrer-Policy')?.args.slice(1)).toEqual(['no-referrer', 'always']);
    });

    it('works out $csp with a map, not a set, so the header also exists on a reply made before any set has run (a 414, a TRACE)', () => {
      const maps = find(conf, 'map').filter((n) => n.args[1] === '$csp');
      expect(maps).toHaveLength(1);
      expect(find(maps[0]!.children ?? [], 'default')).toHaveLength(1);
      expect(find(server.children ?? [], 'set').filter((n) => n.args[0] === '$csp')).toEqual([]);
    });

    it('lets every /bff location inherit them, since none of them sets an add_header of its own, which would drop the server’s', () => {
      expect(bff.length).toBeGreaterThan(0);
      for (const l of bff) expect(find(l.children ?? [], 'add_header'), place(l)).toEqual([]);
    });

    it('still repeats all four in each location that sets its own, because that location drops the inherited ones', () => {
      for (const l of locations.filter((x) => find(x.children ?? [], 'add_header').length > 0)) {
        const names = find(l.children ?? [], 'add_header').map((n) => n.args[0]);
        for (const h of HEADERS) expect(names, `${place(l)} has ${h}`).toContain(h);
      }
    });

    it('hides the copies the BFF sends, so a proxied reply carries each header once', () => {
      const hidden = find(parse(file('bff-proxy.inc')), 'proxy_hide_header').map((n) => n.args[0]);
      for (const h of ['X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Content-Security-Policy']) expect(hidden, h).toContain(h);
    });
  });

  describe('the logos (IN-69)', () => {
    const logos = locations.find((l) => /logo/.test(place(l)));
    const pattern = () => new RegExp(place(logos as Node).replace(/^~\*\s*/, ''), 'i');

    it('are one location, cached for a day, and not pinned for a year', () => {
      expect(logos, 'a logo location').toBeDefined();
      const cache = find(logos?.children ?? [], 'add_header').find((n) => n.args[0] === 'Cache-Control')?.args[1];
      expect(cache).toBe('public, max-age=86400');
    });

    it('matches the three the page loads, among them the white one of the sidebar', () => {
      for (const path of ['/logo.png', '/logo-mark.png', '/logo-icon.png', '/logo-white.png']) expect(pattern().test(path), path).toBe(true);
    });

    it('matches nothing else: a file that merely starts with logo goes to the page', () => {
      for (const path of ['/logo.pngx', '/logos.png', '/logo-other.png', '/x/logo.png', '/logo-white.jpg']) expect(pattern().test(path), path).toBe(false);
    });

    it('names, in public/, a file for every path it caches, so none is a comment’s promise alone', () => {
      const names = ['logo.png', 'logo-mark.png', 'logo-white.png'];
      for (const name of names) expect(readFileSync(fileURLToPath(new URL(`../../../web/public/${name}`, import.meta.url))).length, name).toBeGreaterThan(0);
    });
  });

  describe('dot-files (SC-28)', () => {
    const dot = locations.find((l) => place(l).startsWith('~ ^/(?!bff/)'));
    // nginx decodes and normalises the path before it picks a location, so this reads the decoded path.
    const pattern = new RegExp(String(dot?.args[1]));

    it('answers 404 for a path with a dot-file segment, with the four security headers', () => {
      expect(dot, 'a dot-file location').toBeDefined();
      expect(find(dot?.children ?? [], 'return').map((n) => n.args.join(' '))).toEqual(['404']);
      expect(find(dot?.children ?? [], 'add_header').map((n) => n.args[0]).sort()).toEqual([
        'Content-Security-Policy',
        'Referrer-Policy',
        'X-Content-Type-Options',
        'X-Frame-Options',
      ]);
      expect(find(dot?.children ?? [], 'try_files')).toEqual([]);
    });

    it('matches every dot-file path, wherever the dot-file is', () => {
      for (const path of ['/.env', '/.git/config', '/.git', '/a/.b', '/assets/.hidden', '/a/b/.c/d', '/.well-known/x', '/..']) {
        expect(pattern.test(path), path).toBe(true);
      }
    });

    it('leaves the app, its files and /bff alone, including a name that merely contains a dot', () => {
      for (const path of [
        '/',
        '/problems',
        '/index.html',
        '/assets/Maps-Mhezgn4X.js',
        '/fonts/inter-latin.woff2',
        '/logo.png',
        '/logo-mark.png',
        '/bff/api/hosts',
        '/bff/api/sli/export',
        '/bff/.env',
        '/a.b/c',
      ]) {
        expect(pattern.test(path), path).toBe(false);
      }
    });

    it('comes before the logo location, because the first regex that matches wins', () => {
      const names = locations.map(place);
      expect(names.indexOf(place(dot as Node))).toBeLessThan(names.findIndex((n) => n.includes('logo')));
    });
  });

  it('gives no directive twice in one block, which nginx refuses to start on', () => {
    const once = [
      'proxy_read_timeout',
      'proxy_buffering',
      'proxy_cache',
      'proxy_pass',
      'proxy_http_version',
      'resolver',
      'gzip',
      'server_tokens',
    ];
    const check = (n: Node, where: string) => {
      for (const name of once) {
        expect(find(n.children ?? [], name).length, `${name} in ${where}`).toBeLessThanOrEqual(1);
      }
      for (const child of n.children ?? []) if (child.children) check(child, `${where} > ${child.name} ${child.args.join(' ')}`);
    };
    for (const n of conf) if (n.children) check(n, n.name);
  });

  describe('timeouts and buffering (FR-11)', () => {
    it('waits six minutes on an ordinary read, longer than the page does, and buffers it', () => {
      const ordinary = bff.find((l) => place(l) === '/bff/') as Node;
      expect(timeout(ordinary)).toBe(360);
      expect(timeout(ordinary)).toBeGreaterThan(Number((/REQUEST_TIMEOUT_MS\s*=\s*([\d_]+)/.exec(apiSource)?.[1] ?? '').replace(/_/g, '')) / 1000);
      expect(buffering(ordinary)).toBe('on');
    });

    it('keeps the hour and the unbuffered pass-through for the two event streams only', () => {
      for (const l of bff) {
        const stream = place(l) === '= /bff/api/stream' || place(l) === '= /bff/api/chat';
        expect(timeout(l) > 600, place(l)).toBe(stream);
        expect(buffering(l) === 'off', place(l)).toBe(stream);
      }
      const stream = bff.find((l) => place(l) === '= /bff/api/stream') as Node;
      expect(timeout(stream)).toBe(3600);
    });

    it('lets an explanation outlast the BFF’s own 120 s limit on a local model', () => {
      const explain = bff.find((l) => place(l) === '/bff/api/explain/') as Node;
      expect(timeout(explain)).toBeGreaterThan(120);
      expect(timeout(explain)).toBeLessThan(600);
    });

    it('keeps the browser’s explain deadline between the BFF’s longest wait and nginx’s own', () => {
      // Three numbers in three files. If nginx gave up first, the page would get a bare 504
      // instead of its own message; if the browser gave up first, the BFF would still be waiting.
      const explain = bff.find((l) => place(l) === '/bff/api/explain/') as Node;
      const num = (v: string | undefined) => Number((v ?? '').replace(/_/g, ''));
      const browser = num(/EXPLAIN_TIMEOUT_MS\s*=\s*([\d_]+)/.exec(apiSource)?.[1]) / 1000;
      const ai = /envNum\('AI_TIMEOUT_MS',[^?]+\?\s*([\d_]+)\s*:\s*([\d_]+)\)/.exec(configSource);
      const retries = num(/envNum\('AI_MAX_RETRIES',\s*([\d_]+)\)/.exec(configSource)?.[1]);
      const hosted = (num(ai?.[1]) * (1 + retries)) / 1000;
      const local = num(ai?.[2]) / 1000;
      for (const n of [browser, hosted, local]) expect(Number.isFinite(n) && n > 0, 'a number was not found where expected').toBe(true);
      expect(browser).toBeGreaterThan(Math.max(hosted, local));
      expect(timeout(explain)).toBeGreaterThan(browser);
    });

    it('lets the monthly SLA and its download wait longer than the page’s own deadline, which is longer than a minute', () => {
      // The first SLA after a restart reads months of events and has not been timed on the real
      // estate. If nginx gave up first the page would get a bare 504, and a minute is too short.
      const sli = bff.find((l) => place(l) === '/bff/api/sli') as Node;
      const browser = Number((/SLI_TIMEOUT_MS\s*=\s*([\d_]+)/.exec(apiSource)?.[1] ?? '').replace(/_/g, '')) / 1000;
      expect(Number.isFinite(browser) && browser > 0, 'SLI_TIMEOUT_MS was not found').toBe(true);
      expect(browser).toBeGreaterThan(120); // the download's own give-up (ReportDownload GIVE_UP_AFTER_MS)
      expect(timeout(sli)).toBeGreaterThan(browser);
      expect(timeout(sli)).toBeLessThan(600);
      expect(buffering(sli)).toBe('on');
    });

    it('keeps the stream’s errors out of the log that would hold its request line', () => {
      const stream = bff.find((l) => place(l) === '= /bff/api/stream') as Node;
      expect(find(stream.children ?? [], 'error_log')[0]?.args.at(-1)).toBe('crit');
    });
  });

  describe('finding the BFF again after it is recreated (IN-15)', () => {
    it('asks Docker’s DNS at run time, and keeps asking', () => {
      const resolver = find(server.children ?? [], 'resolver')[0];
      expect(resolver?.args[0]).toBe('127.0.0.11');
      expect(resolver?.args.join(' ')).toMatch(/valid=\d+s/);
    });

    it('proxies through a variable set on the server, never a fixed host name nginx would resolve once', () => {
      const set = find(server.children ?? [], 'set').find((n) => n.args[0] === '$bff_upstream');
      expect(set?.args[1]).toBe('http://portal-bff:4000');
      for (const l of bff) expect(find(l.children ?? [], 'proxy_pass')[0]?.args, place(l)).toEqual(['$bff_upstream']);
      expect(source).not.toMatch(/proxy_pass\s+http:\/\/portal-bff/);
    });

    it('still strips the /bff prefix, and does it before the request is passed on', () => {
      for (const l of bff) {
        const kids = l.children ?? [];
        const rewrite = kids.findIndex((n) => n.name === 'rewrite');
        const pass = kids.findIndex((n) => n.name === 'proxy_pass');
        expect(rewrite, place(l)).toBeGreaterThanOrEqual(0);
        expect(rewrite, place(l)).toBeLessThan(pass);
        const [pattern, replacement, flag] = kids[rewrite].args;
        expect(flag).toBe('break');
        const strip = (path: string) => path.replace(new RegExp(pattern), replacement);
        expect(strip('/bff/api/hosts')).toBe('/api/hosts');
        expect(strip('/bff/api/stream')).toBe('/api/stream');
        expect(strip('/bff/api/explain/problem')).toBe('/api/explain/problem');
        expect(strip('/bff/api/problems/acknowledge')).toBe('/api/problems/acknowledge');
      }
    });
  });

  describe('what every /bff location sends the BFF', () => {
    const sent = (l: Node, name: string) =>
      find(l.children ?? [], 'proxy_set_header')
        .filter((n) => n.args[0] === name)
        .map((n) => n.args[1]);

    it('speaks HTTP/1.1 and sends no Connection header, so the event streams can stay open', () => {
      for (const l of bff) {
        expect(own(l, 'proxy_http_version'), place(l)).toBe('1.1');
        expect(sent(l, 'Connection'), place(l)).toEqual(['']);
      }
    });

    it('passes on the Host the browser sent, port included, which the BFF checks every cookie POST against (SC-11)', () => {
      for (const l of bff) expect(sent(l, 'Host'), place(l)).toEqual(['$http_host']);
    });

    it('appends to X-Forwarded-For rather than replacing it, which the BFF’s per-client rate limit reads (SC-05)', () => {
      for (const l of bff) expect(sent(l, 'X-Forwarded-For'), place(l)).toEqual(['$proxy_add_x_forwarded_for']);
    });

    it('leaves compression to the BFF, which gzips its own JSON', () => {
      for (const l of bff) expect(own(l, 'gzip'), place(l)).toBe('off');
    });

    it('gives the BFF nginx’s own request id, never a client’s, so one id finds the request in both logs (IN-09)', () => {
      // proxy_set_header replaces whatever header the client sent under that name.
      for (const l of bff) expect(sent(l, 'X-Request-Id'), place(l)).toEqual(['$request_id']);
    });
  });

  describe('the access log', () => {
    const format = (conf.find((n) => n.name === 'log_format' && n.args[0] === 'portal')?.args.slice(1) ?? []).join('');

    it('writes the request id next to the line the BFF logs it under (IN-09)', () => {
      expect(format).toContain('rid=$request_id');
    });

    it('still writes the redacted request line, never the raw one, which may hold a ?token= (SC-03)', () => {
      expect(format).toContain('"$request_redacted"');
      expect(format).not.toMatch(/\$request(?![_\w])/);
    });

    it('is the format the server uses', () => {
      expect(find(server.children ?? [], 'access_log').at(-1)?.args).toEqual(['/var/log/nginx/access.log', 'portal']);
    });
  });
});
