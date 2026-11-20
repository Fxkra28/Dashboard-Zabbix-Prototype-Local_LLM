import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

/**
 * deploy/portal-probe.sh gives HCML's Zabbix one value a call. Here curl, openssl and nvidia-smi are stand-ins that print what a made-up portal, certificate and card would, so each case is a machine
 * and the value it prints is the thing under test. The last case holds the agent's keys file and the template to each other, since a key in one and not the other is an item that never has data.
 */

const run = promisify(execFile);
const root = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const script = root('deploy/portal-probe.sh');
const which = (name: string) => {
  try {
    return execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};
const bash = which('bash');
// `sleep` is here for the stand-ins that never answer: without it on the path they fail at once, and a limit that was never applied would still pass.
const tools = ['date', 'sed', 'tail', 'grep', 'head', 'cut', 'tr', 'ls', 'stat', 'sleep'].map((t) => [t, which(t)] as const);
// `timeout` is not on every machine (a Mac has none unless coreutils is there): the cases that need it are skipped without it.
const timeoutTool = which('timeout') || which('gtimeout');
const canRun = Boolean(bash) && tools.every(([, path]) => path);

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) {
    try {
      chmodSync(join(dir, 'backups'), 0o700);
    } catch {
      /* no folder of backups in this one */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

interface Machine {
  /** What the portal answers: the body and the status; `null` leaves curl out. */
  portal?: { body: string; code: number } | null;
  /** The `notAfter` that the certificate shows, as openssl prints it; `null` leaves openssl out and `''` shows no certificate. */
  notAfter?: string | null;
  /** What nvidia-smi prints for the temperature and for the memory; `null` leaves it out. */
  card?: { temp: string; mem: string } | null;
  /** The status that Ollama answers its list of models with, through the same curl; 0 is no answer. */
  ollama?: number;
  /** Backup files in a folder, with their ages in hours; `[]` is an empty folder. The folder is passed to the probe as its argument. */
  backups?: number[];
  /** The folder of backups cannot be listed by the user the probe runs as, as one made by the backup script for root is for the agent. */
  unreadable?: boolean;
  /** A curl or an openssl that takes the call and never answers, and ignores its own limit as a stuck one would. */
  hang?: 'curl' | 'openssl' | 'nvidia-smi';
  /** Put the machine's own `timeout` in the path, as most Linux machines have. */
  withTimeout?: boolean;
}

async function probe(m: Machine, ...args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'probe-'));
  made.push(dir);
  const stub = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!${bash}\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  for (const [name, path] of tools) symlinkSync(path, join(dir, name));
  if (m.withTimeout && timeoutTool) symlinkSync(timeoutTool, join(dir, 'timeout'));
  if (m.hang === 'curl') stub('curl', 'sleep 30');
  else if (m.portal || m.ollama !== undefined) {
    // Asked for a status alone (-o /dev/null) it prints that; asked for the health body it prints the body and the status.
    const portal = m.portal ?? { body: '', code: 0 };
    stub('curl', `case "$*" in *"-o /dev/null"*) printf '%s' '${m.ollama ?? 0}' ;; *) printf '%s\\n%s' '${portal.body}' '${portal.code}' ;; esac`);
  }
  // The connection never answers; the second openssl of the probe, which reads the certificate, does what the real one does when the first is stopped: it reads to the end of its input and finds nothing.
  if (m.hang === 'openssl') stub('openssl', 'case "$1" in s_client) sleep 30;; x509) cat >/dev/null;; esac');
  else if (m.notAfter !== null && m.notAfter !== undefined) {
    const end = m.notAfter ? `echo 'notAfter=${m.notAfter}'` : 'true';
    stub('openssl', `case "$1" in s_client) cat >/dev/null; echo CERT;; x509) cat >/dev/null; ${end};; esac`);
  }
  if (m.hang === 'nvidia-smi') stub('nvidia-smi', 'sleep 30');
  else if (m.card) stub('nvidia-smi', `case "$*" in *temperature*) echo '${m.card.temp}';; *memory*) echo '${m.card.mem}';; esac`);
  // The folder of backup files: 'BACKUPS' in the arguments is its path.
  const folder = join(dir, 'backups');
  if (m.backups) {
    mkdirSync(folder);
    m.backups.forEach((hours, i) => {
      const file = join(folder, `hcml-hcml-portal-ollama-state-2026111${i}T000000Z.tar.gz.enc`);
      writeFileSync(file, 'x');
      const at = Date.now() / 1000 - hours * 3600;
      utimesSync(file, at, at);
    });
    // Not a backup: a newer file of another kind must not make the newest backup look young.
    writeFileSync(join(folder, 'notes.txt'), 'x');
    if (m.unreadable) chmodSync(folder, 0o000);
  }
  const started = Date.now();
  const { stdout, stderr } = await run(bash, [script, ...args.map((a) => (a === 'BACKUPS' ? folder : a))], { env: { PATH: dir }, timeout: 20_000 });
  return { out: stdout.trim(), err: stderr.trim(), seconds: (Date.now() - started) / 1000 };
}

/** openssl's own way of writing a moment: three-letter month, a day padded with a space, the time, the year and GMT. */
function endsIn(seconds: number): string {
  const d = new Date(Date.now() + seconds * 1000);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  const two = (n: number) => String(n).padStart(2, '0');
  return `${month} ${String(d.getUTCDate()).padStart(2, ' ')} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} ${d.getUTCFullYear()} GMT`;
}

const OK = { body: '{"ok":true,"ts":1,"ai":true,"ready":true}', code: 200 };

describe.skipIf(!canRun)('deploy/portal-probe.sh', { timeout: 60_000 }, () => {
  it('says 1 for a portal that answers 200 and says it is ok, and 0 for one that answers 503, says ok:false, or does not answer', async () => {
    expect((await probe({ portal: OK }, 'health')).out).toBe('1');
    expect((await probe({ portal: { body: '{"ok":false}', code: 200 } }, 'health')).out).toBe('0');
    expect((await probe({ portal: { body: '{"ok":true}', code: 503 } }, 'health')).out).toBe('0');
    expect((await probe({ portal: { body: '', code: 0 } }, 'health')).out).toBe('0');
  });

  it('says 1 only when the portal says that its own Zabbix answers', async () => {
    expect((await probe({ portal: OK }, 'zabbix')).out).toBe('1');
    expect((await probe({ portal: { body: '{"ok":true,"ready":false}', code: 200 } }, 'zabbix')).out).toBe('0');
  });

  it('counts the whole days left on a certificate, and a negative number once it has ended', async () => {
    expect((await probe({ notAfter: endsIn(10 * 86400 + 3 * 3600) }, 'cert-days', 'portal.example.com')).out).toBe('10');
    expect((await probe({ notAfter: endsIn(1800) }, 'cert-days', 'portal.example.com', '8443')).out).toBe('0');
    expect((await probe({ notAfter: endsIn(-3600) }, 'cert-days', 'portal.example.com')).out).toBe('-1');
    expect((await probe({ notAfter: endsIn(-5 * 86400 - 60) }, 'cert-days', 'portal.example.com')).out).toBe('-6');
  });

  it('prints ZBX_NOTSUPPORTED, with the reason on stderr, for what it cannot read', async () => {
    const noCert = await probe({ notAfter: '' }, 'cert-days', 'portal.example.com');
    expect(noCert.out).toBe('ZBX_NOTSUPPORTED');
    expect(noCert.err).toContain('no certificate was shown');
    expect((await probe({}, 'cert-days')).out).toBe('ZBX_NOTSUPPORTED');
    expect((await probe({}, 'cert-days', 'portal.example.com')).err).toContain('openssl is not here');
    expect((await probe({}, 'health')).err).toContain('curl is not here');
    expect((await probe({}, 'gpu-temp')).err).toContain('nvidia-smi is not here');
    expect((await probe({}, 'nothing-like-this')).err).toContain('unknown probe');
  });

  it('reads the first card: its temperature, and its memory in use as a whole percent', async () => {
    const card = { temp: '71\n64', mem: ' 9000, 24000 \n 100, 24000' };
    expect((await probe({ card }, 'gpu-temp')).out).toBe('71');
    expect((await probe({ card }, 'gpu-mem-pct')).out).toBe('37');
    expect((await probe({ card: { temp: '[N/A]', mem: '[N/A], [N/A]' } }, 'gpu-temp')).out).toBe('ZBX_NOTSUPPORTED');
    expect((await probe({ card: { temp: '60', mem: '0, 0' } }, 'gpu-mem-pct')).out).toBe('ZBX_NOTSUPPORTED');
  });

  // IN-102: the agent waits 3 seconds unless its Timeout says more: a probe that waits longer leaves the item unsupported, where 0 would raise the trigger.
  it.skipIf(!timeoutTool)('stops a curl that never answers after two seconds and says 0, where a longer wait would have left the item unsupported', async () => {
    const { out, seconds } = await probe({ hang: 'curl', withTimeout: true }, 'health');
    expect(out).toBe('0');
    expect(seconds).toBeLessThan(3);
  });

  it.skipIf(!timeoutTool)('stops an openssl that never answers after two seconds, and says it could not read the certificate', async () => {
    const { out, err, seconds } = await probe({ hang: 'openssl', withTimeout: true }, 'cert-days', 'portal.example.com');
    expect(out).toBe('ZBX_NOTSUPPORTED');
    expect(err).toContain('no certificate was shown');
    expect(seconds).toBeLessThan(3);
  });

  // A card that is wedged leaves nvidia-smi waiting for it: the agent gives up after 3 seconds and the item is unsupported, with nothing said of why.
  it.skipIf(!timeoutTool)('stops an nvidia-smi that never answers after two seconds, for the temperature and for the memory', async () => {
    for (const key of ['gpu-temp', 'gpu-mem-pct']) {
      const { out, err, seconds } = await probe({ hang: 'nvidia-smi', withTimeout: true }, key);
      expect(out, key).toBe('ZBX_NOTSUPPORTED');
      expect(err, key).toContain('no card was read');
      expect(seconds, key).toBeLessThan(3);
    }
  });

  it('asks curl for no more than two seconds, below the three of the agent, and no more than that however it is called', () => {
    const text = readFileSync(script, 'utf8');
    expect(text).toMatch(/^LIMIT=2$/m);
    for (const line of text.split('\n').filter((l) => /\bcurl\b.* -s /.test(l))) expect(line).toContain('--max-time "$LIMIT"');
    expect(text).toMatch(/limited openssl s_client/);
  });

  it('says 1 when the model server answers its list of models, and 0 for any other answer or none', async () => {
    expect((await probe({ ollama: 200 }, 'ollama')).out).toBe('1');
    expect((await probe({ ollama: 500 }, 'ollama')).out).toBe('0');
    expect((await probe({ ollama: 0 }, 'ollama')).out).toBe('0');
    expect((await probe({}, 'ollama')).err).toContain('curl is not here');
  });

  it('says how many whole hours old the newest backup is, by the files that are backups, and not supported when there is none', async () => {
    expect((await probe({ backups: [30, 5, 77] }, 'backup-age', 'BACKUPS')).out).toBe('5');
    expect((await probe({ backups: [49.9] }, 'backup-age', 'BACKUPS')).out).toBe('49');
    const none = await probe({ backups: [] }, 'backup-age', 'BACKUPS');
    expect(none.out).toBe('ZBX_NOTSUPPORTED');
    expect(none.err).toContain('no backup file');
    const missing = await probe({}, 'backup-age', '/nowhere/at/all');
    expect(missing.out).toBe('ZBX_NOTSUPPORTED');
    expect(missing.err).toContain('is not a folder');
  });

  // The backup script makes its folder for its own user alone (0700), and the agent runs as another: the probe must say that it cannot read the folder, and not that there is no backup, which sent
  // the operator to look for a backup that was there. Root reads anything, so the case is skipped for it.
  it.skipIf(process.getuid?.() === 0)('says that the folder cannot be read by this user, and not that it holds no backup, when it cannot', async () => {
    const hidden = await probe({ backups: [5], unreadable: true }, 'backup-age', 'BACKUPS');
    expect(hidden.out).toBe('ZBX_NOTSUPPORTED');
    expect(hidden.err).toContain('cannot be read');
    expect(hidden.err).not.toContain('no backup file');
    expect(hidden.err).toContain('mode 750');
  });

  it('prints its own header for --help and for no argument', async () => {
    const { out } = await probe({}, '--help');
    expect(out).toContain('One value a call');
    expect(out).toContain('cert-days HOST [PORT]');
    expect(out).not.toContain('set -u');
  });
});

describe('the keys file and the template of the Zabbix agent', () => {
  const conf = readFileSync(root('deploy/zabbix/hcml-portal.conf'), 'utf8');
  const template = readFileSync(root('deploy/zabbix/template-hcml-portal.yaml'), 'utf8');
  const confKeys = [...conf.matchAll(/^UserParameter=([^,\n]+(?:\[[^\]]*\])?),(.+)$/gm)].map((m) => ({ key: m[1], command: m[2] }));
  const itemKeys = [...template.matchAll(/^ {10}key: '([^']+)'$/gm)].map((m) => m[1]);
  const base = (key: string) => key.replace(/\[.*$/, '');

  it('gives each item of the template a key in the agent file, and each key an item', () => {
    expect(confKeys.length).toBeGreaterThan(0);
    expect(itemKeys.map(base).sort()).toEqual(confKeys.map((k) => base(k.key)).sort());
  });

  it('runs only probes that deploy/portal-probe.sh knows, and passes the host and the port to cert-days', () => {
    const known = new Set(['health', 'zabbix', 'cert-days', 'gpu-temp', 'gpu-mem-pct', 'ollama', 'backup-age']);
    for (const { command } of confKeys) {
      const words = command.trim().split(/\s+/);
      expect(known.has(words[words.findIndex((w) => w.endsWith('/portal-probe.sh')) + 1]), command).toBe(true);
    }
    expect(confKeys.find((k) => k.key.startsWith('hcml.portal.cert.days'))?.command).toMatch(/cert-days \$1 \$2$/);
    expect(confKeys.find((k) => k.key.startsWith('hcml.portal.backup.age'))?.command).toMatch(/backup-age \$1$/);
  });

  it('has a unique 32-digit id on everything it defines, a trigger on only keys it defines, and no macro that it does not set', () => {
    const ids = [...template.matchAll(/uuid: ([0-9a-f]+)$/gm)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(1 + 1 + itemKeys.length);
    expect(ids.every((id) => id.length === 32)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    const triggerKeys = [...template.matchAll(/expression: '.*?\(\/HCML Monitoring Portal\/(hcml\.portal\.[a-z.]+(?:\[[^\]]*\])?)/g)].map((m) => m[1]);
    for (const key of triggerKeys) expect(itemKeys, key).toContain(key);
    const defined = new Set([...template.matchAll(/macro: '(\{\$[A-Z.]+\})'/g)].map((m) => m[1]));
    const used = new Set([...template.matchAll(/\{\$[A-Z.]+\}/g)].map((m) => m[0]));
    for (const macro of used) expect(defined.has(macro), macro).toBe(true);
  });

  it('says in its own text that it was written for Zabbix 7.0 and has not been imported', () => {
    expect(template).toContain("version: '7.0'");
    expect(template).toContain('not yet imported');
  });
});

// IN-102 and IN-106: the template as a Zabbix reads it, parsed and not matched by patterns.
describe('the template, parsed as YAML', () => {
  const doc = parseYaml(readFileSync(root('deploy/zabbix/template-hcml-portal.yaml'), 'utf8')) as {
    zabbix_export: { version: string; templates: { template: string; items: { key: string; value_type?: string; triggers?: { expression: string; priority: string; name: string }[] }[]; macros: { macro: string; value: string }[] }[] };
  };
  const t = doc.zabbix_export.templates[0];
  const triggers = t.items.flatMap((i) => (i.triggers ?? []).map((tr) => ({ key: i.key, ...tr })));

  it('is one template of Zabbix 7.0 with the items of the keys file', () => {
    expect(doc.zabbix_export.version).toBe('7.0');
    expect(t.template).toBe('HCML Monitoring Portal');
    expect(t.items.map((i) => i.key.replace(/\[.*$/, '')).sort()).toEqual(['hcml.portal.backup.age', 'hcml.portal.cert.days', 'hcml.portal.gpu.mem.pct', 'hcml.portal.gpu.temp', 'hcml.portal.health', 'hcml.portal.ollama', 'hcml.portal.zabbix']);
  });

  it('has a nodata trigger on the health, the certificate, the model server and the backup, for an item that stops reporting and so never reads 0', () => {
    for (const key of ['hcml.portal.health', 'hcml.portal.cert.days', 'hcml.portal.ollama', 'hcml.portal.backup.age']) {
      const found = triggers.filter((tr) => tr.key.startsWith(key) && tr.expression.startsWith('nodata('));
      expect(found.length, key).toBe(1);
    }
  });

  it('raises a problem for a model server that does not answer, and for a backup older than the macro says', () => {
    expect(triggers.find((tr) => tr.key === 'hcml.portal.ollama' && tr.expression.startsWith('max('))?.expression).toContain('#5)=0');
    expect(triggers.find((tr) => tr.key.startsWith('hcml.portal.backup.age') && tr.expression.startsWith('last('))?.expression).toContain('>{$PORTAL.BACKUP.MAX.HOURS}');
    expect(Object.fromEntries(t.macros.map((m) => [m.macro, m.value]))).toMatchObject({ '{$PORTAL.BACKUP.DIR}': '/var/backups/hcml', '{$PORTAL.BACKUP.MAX.HOURS}': '36' });
  });

  it('gives every trigger a priority Zabbix knows and a name that is not empty', () => {
    for (const tr of triggers) {
      expect(['INFO', 'WARNING', 'AVERAGE', 'HIGH', 'DISASTER']).toContain(tr.priority);
      expect(tr.name.trim()).not.toBe('');
    }
  });
});

