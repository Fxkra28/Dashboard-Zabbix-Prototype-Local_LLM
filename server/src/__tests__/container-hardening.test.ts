import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The container hardening in both Dockerfiles, docker-compose.yml and web/nginx.conf, read as text.
 *
 * Docker cannot run where these tests do, and several settings only work as a pair: the port a
 * non-root nginx listens on has to match the one compose publishes and the one the healthcheck
 * asks, and a read-only root filesystem needs the tmpfs that nginx writes its temp files to. A
 * change to one file alone is found only when the owner rebuilds, so this reads them together. It
 * runs against whichever copy it sits in, so it uses nothing that differs between hcml-portal and
 * hcml-portal-ollama.
 */
const root = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const lines = (path: string) => readFileSync(root(path), 'utf8').split('\n');
const code = (list: string[]) => list.filter((l) => l.trim() !== '' && !/^\s*#/.test(l));

const compose = lines('docker-compose.yml');
const serverDockerfile = code(lines('server/Dockerfile'));
const webDockerfile = code(lines('web/Dockerfile'));
const nginx = readFileSync(root('web/nginx.conf'), 'utf8');

/** A service's own lines, comments removed, from its key to the next service. */
function service(name: string): string[] {
  const start = compose.findIndex((l) => l === `  ${name}:`);
  expect(start, `a ${name} service`).toBeGreaterThanOrEqual(0);
  const rest = compose.slice(start + 1);
  const end = rest.findIndex((l) => /^ {2}\S/.test(l));
  return code(end === -1 ? rest : rest.slice(0, end));
}

/** The `- item` lines under a key of the service, with any quotes removed. */
function items(block: string[], key: string): string[] {
  const at = block.indexOf(`    ${key}:`);
  if (at < 0) return [];
  const out: string[] = [];
  for (const l of block.slice(at + 1)) {
    const m = /^ {6}- (.*)$/.exec(l);
    if (!m) break;
    out.push(m[1].replace(/^"(.*)"$/, '$1'));
  }
  return out;
}

const scalar = (block: string[], key: string) => block.map((l) => new RegExp(`^ {4}${key}: (.*)$`).exec(l)?.[1]).find((v) => v !== undefined);

/** `2g`, `256m` or `16m` as bytes; NaN for anything else, so a typo cannot pass as a number. */
function bytes(value: string | undefined): number {
  const m = /^(\d+)([mg])$/.exec(value ?? '');
  return m ? Number(m[1]) * (m[2] === 'g' ? 1024 ** 3 : 1024 ** 2) : NaN;
}

/** The command a service's healthcheck runs, as the JSON array compose reads. */
function healthcheck(block: string[]): string[] {
  const at = block.indexOf('    healthcheck:');
  expect(at, 'a healthcheck').toBeGreaterThanOrEqual(0);
  const test = block.slice(at + 1).map((l) => /^ {6}test: (\[.*\])$/.exec(l)?.[1]).find(Boolean);
  expect(test, 'a healthcheck test written as a JSON array').toBeDefined();
  return JSON.parse(test as string) as string[];
}

/** The last build stage of a Dockerfile: from its final FROM to the end. */
const finalStage = (file: string[]) => file.slice(file.map((l) => /^FROM /.test(l)).lastIndexOf(true));

const SERVICES = ['portal-bff', 'portal-web'] as const;

describe('the images (SC-21)', () => {
  it('runs the BFF as the image’s own node user, set after every step that needs root and before it starts', () => {
    const stage = finalStage(serverDockerfile);
    expect(stage.filter((l) => l.startsWith('USER '))).toEqual(['USER node']);
    const user = stage.indexOf('USER node');
    const lastBuildStep = stage.reduce((at, l, i) => (/^(RUN|COPY|ADD) /.test(l) ? i : at), -1);
    expect(user, 'USER node comes after the last RUN, COPY or ADD').toBeGreaterThan(lastBuildStep);
    expect(user, 'and before CMD').toBeLessThan(stage.findIndex((l) => l.startsWith('CMD ')));
  });

  it('serves the web app from the unprivileged nginx image, and is root for one step only, the upgrade of the system packages (IN-75)', () => {
    const stage = finalStage(webDockerfile);
    expect(stage[0]).toMatch(/^FROM nginxinc\/nginx-unprivileged:/);
    // The base image's own user is uid 101; it is given back at once, before anything of ours is copied in.
    expect(stage.filter((l) => l.startsWith('USER '))).toEqual(['USER root', 'USER 101']);
    const root = stage.indexOf('USER root');
    const back = stage.indexOf('USER 101');
    expect(root).toBeLessThan(back);
    expect(stage.slice(root + 1, back).filter((l) => /^(RUN|COPY|ADD) /.test(l))).toEqual(['RUN apk upgrade --no-cache']);
    expect(stage.slice(back + 1).some((l) => /^USER /.test(l))).toBe(false);
    const lastStep = stage.reduce((at, l, i) => (/^(RUN|COPY|ADD) /.test(l) ? i : at), -1);
    expect(back, 'the user is back before the first COPY of the app').toBeLessThan(stage.findIndex((l) => l.startsWith('COPY ')));
    expect(lastStep).toBeGreaterThan(back);
  });

  it('runs the upgrade of the system packages again each month: an ARG before it, which the compose file feeds (IN-75)', () => {
    // A layer is reused while its text and its parent are the same, and the base is pinned by digest: without a value that changes, `apk upgrade` would run once.
    const stage = finalStage(webDockerfile);
    const arg = stage.indexOf('ARG APK_ROUND');
    const upgrade = stage.indexOf('RUN apk upgrade --no-cache');
    expect(arg).toBeGreaterThan(-1);
    expect(arg).toBeLessThan(upgrade);
    expect(compose.join('\n')).toMatch(/portal-web:\n\s+build:\n\s+context: \.\/web\n\s+args:\n(?:\s+#.*\n)*\s+APK_ROUND: \$\{APK_ROUND:-\}/);
  });

  it('names an explicit minor version for every base image, never a major alone or a moving word', () => {
    const froms = [...serverDockerfile, ...webDockerfile].filter((l) => l.startsWith('FROM '));
    expect(froms.length).toBe(4);
    for (const l of froms) {
      const tag = /^FROM \S+?:([^@\s]+)(?:@\S+)?(?: AS \S+)?$/.exec(l)?.[1];
      expect(tag, l).toBeDefined();
      // 24.11-alpine and 1.28-alpine pass; 24-alpine, alpine, latest and stable do not.
      expect(tag, l).toMatch(/^\d+\.\d+(?:\.\d+)?(?:-[a-z0-9.]+)?$/);
    }
  });

  it('pins every base image to a digest as well, so a rebuild cannot move to different bytes under the same tag', () => {
    const froms = [...serverDockerfile, ...webDockerfile].filter((l) => l.startsWith('FROM '));
    for (const l of froms) expect(l, l).toMatch(/^FROM \S+?:[^@\s]+@sha256:[0-9a-f]{64}(?: AS \S+)?$/);
  });

  it('builds on a Node that is not older than the one the project\'s own tests need (IN-54)', () => {
    // The tests need 24.15 at the oldest (jsdom); an image frozen on an older minor would run something the tests never saw.
    const minors = [...serverDockerfile, ...webDockerfile]
      .filter((l) => /^FROM node:/.test(l))
      .map((l) => Number(/^FROM node:24\.(\d+)/.exec(l)?.[1]));
    expect(minors.length).toBe(3);
    for (const minor of minors) expect(minor).toBeGreaterThanOrEqual(15);
  });

  it('serves from an nginx line that still gets images: 1.30 or later (IN-66)', () => {
    // 1.28-alpine of this image has not moved since 23 February 2026 and stands behind 21 advisories; 1.30 and 1.31 move.
    const tag = /^FROM nginxinc\/nginx-unprivileged:(\d+)\.(\d+)/.exec(finalStage(webDockerfile)[0]!);
    expect(tag, 'an nginx-unprivileged tag with a major and a minor').not.toBeNull();
    const [major, minor] = [Number(tag![1]), Number(tag![2])];
    expect(major * 100 + minor).toBeGreaterThanOrEqual(130);
  });

  it('dates the pin in its comment by the day it was taken, not an earlier one (IN-66)', () => {
    const comment = readFileSync(root('server/Dockerfile'), 'utf8').split('\n').slice(0, 4).join(' ');
    expect(comment).toContain('11 November 2026');
    expect(comment).not.toContain('12 October');
  });

  it('builds on one Node version in both images', () => {
    const node = [...serverDockerfile, ...webDockerfile].filter((l) => /^FROM node:/.test(l)).map((l) => /^FROM (\S+)/.exec(l)?.[1]);
    expect(node.length).toBe(3);
    expect(new Set(node).size).toBe(1);
  });
});

describe('what the BFF image carries (IN-71)', () => {
  const stage = finalStage(serverDockerfile).join('\n');

  it('does not keep npm, npx, yarn or corepack, so nothing in a running container can install code', () => {
    expect(stage).toMatch(/rm -rf[^\n]*\/usr\/local\/lib\/node_modules\/npm\b/);
    expect(stage).toMatch(/rm -rf[^\n]*\/usr\/local\/lib\/node_modules\/corepack\b/);
    for (const name of ['npm', 'npx', 'yarn', 'yarnpkg', 'corepack']) expect(stage, name).toContain(`/usr/local/bin/${name}`);
    expect(stage).toContain('/opt/yarn-');
  });

  it('removes them after the step that needs npm, in the same layer, so the layer does not keep them', () => {
    const install = finalStage(serverDockerfile).findIndex((l) => l.startsWith('RUN npm ci --omit=dev'));
    expect(install).toBeGreaterThanOrEqual(0);
    const run = finalStage(serverDockerfile).slice(install).join('\n').split(/\n(?=[A-Z]+ )/)[0]!;
    expect(run).toMatch(/npm ci --omit=dev[\s\S]*&&[\s\S]*rm -rf/);
  });

  it('starts the server with node itself, which the image keeps', () => {
    expect(finalStage(serverDockerfile).find((l) => l.startsWith('CMD '))).toBe('CMD ["node", "dist/index.js"]');
  });

  it('is built without source maps, which nothing in the image reads', () => {
    expect(serverDockerfile.some((l) => /^RUN npm run build -- --sourceMap false$/.test(l))).toBe(true);
    expect(stage).not.toMatch(/enable-source-maps/);
    expect(compose.join('\n')).not.toMatch(/enable-source-maps/);
  });
});

describe('what docker-compose.yml hands each container (SC-21)', () => {
  it.each(SERVICES)('%s: no capabilities, no new privileges, a read-only root with /tmp in memory', (name) => {
    const block = service(name);
    expect(block).toContain('    read_only: true');
    expect(items(block, 'cap_drop')).toEqual(['ALL']);
    expect(items(block, 'security_opt')).toContain('no-new-privileges:true');
    // The only writable path: /tmp may carry options, as in /tmp:size=64m.
    expect(items(block, 'tmpfs').map((t) => t.split(':')[0])).toContain('/tmp');
  });

  it('lets the BFF write in one place besides /tmp, a named volume at /data that the image makes for the node user, and no other container writes anywhere', () => {
    const bff = service('portal-bff');
    const mounts = items(bff, 'volumes');
    // hcml-portal-ollama sends no email and keeps nothing, so it has no volume at all.
    expect([[], ['portal-state:/data']]).toContainEqual(mounts);
    const makes = serverDockerfile.findIndex((l) => l === 'RUN mkdir -p /data && chown node:node /data');
    const user = serverDockerfile.findIndex((l) => l === 'USER node');
    if (mounts.length > 0) {
      expect(makes, 'the image makes /data for the node user').toBeGreaterThanOrEqual(0);
      expect(makes, 'before it drops to that user').toBeLessThan(user);
      expect(compose.join('\n')).toMatch(/^volumes:\n {2}portal-state:\s*$/m);
    }
    expect(items(service('portal-web'), 'volumes')).toEqual([]);
  });

  it.each(SERVICES)('%s: a memory and CPU limit, with room above what its in-memory /tmp can take', (name) => {
    const block = service(name);
    const memory = bytes(scalar(block, 'mem_limit'));
    expect(Number.isFinite(memory), 'mem_limit like 2g or 256m').toBe(true);
    expect(Number(scalar(block, 'cpus')), 'cpus').toBeGreaterThan(0);
    // A tmpfs is memory: its size counts against the container's limit.
    const scratch = items(block, 'tmpfs').reduce((sum, t) => sum + (bytes(/size=(\d+[mg])/.exec(t)?.[1]) || 0), 0);
    expect(memory).toBeGreaterThan(scratch * 2);
  });

  it.each(SERVICES)('%s: a swap limit equal to the memory limit, so the container cannot use swap on top of it (IN-71)', (name) => {
    const block = service(name);
    expect(scalar(block, 'memswap_limit')).toBeDefined();
    expect(bytes(scalar(block, 'memswap_limit'))).toBe(bytes(scalar(block, 'mem_limit')));
  });

  it.each(SERVICES)('%s: a limit on processes, so a runaway fork stops there (IN-71)', (name) => {
    const limit = Number(scalar(service(name), 'pids_limit'));
    expect(Number.isInteger(limit)).toBe(true);
    // Node and nginx hold a few dozen between them at most; the limit is well above that and well below a fork bomb.
    expect(limit).toBeGreaterThanOrEqual(64);
    expect(limit).toBeLessThanOrEqual(1024);
  });

  it('gives the BFF at least 1 GiB, which an SLA month and the 64 MiB response cache fit in many times over', () => {
    expect(bytes(scalar(service('portal-bff'), 'mem_limit'))).toBeGreaterThanOrEqual(1024 ** 3);
  });

  it('sets the BFF’s Node heap explicitly: at least 1 GiB, and well inside the container’s limit', () => {
    // Node takes only a share of a container's limit as its default heap, so a 2g limit alone
    // would not let a big report build use it. The heap is not all of the process: buffers,
    // the in-memory /tmp and the runtime need room under the same limit.
    const block = service('portal-bff');
    const line = block.find((l) => /^ {6}NODE_OPTIONS:/.test(l));
    const heap = Number(/--max-old-space-size=(\d+)"?$/.exec(line ?? '')?.[1]) * 1024 ** 2;
    expect(Number.isFinite(heap), 'NODE_OPTIONS holding --max-old-space-size=<MiB>').toBe(true);
    expect(heap).toBeGreaterThanOrEqual(1024 ** 3);
    expect(heap).toBeLessThanOrEqual(bytes(scalar(block, 'mem_limit')) * 0.75);
  });

  it('runs each healthcheck with a tool that is in that image: node in the BFF, wget in the Alpine nginx', () => {
    expect(healthcheck(service('portal-bff')).slice(0, 2)).toEqual(['CMD', 'node']);
    expect(healthcheck(service('portal-web')).slice(0, 2)).toEqual(['CMD', 'wget']);
  });
});

describe('the port the web container listens on (SC-21)', () => {
  const listen = /^\s*listen\s+(\d+);/m.exec(nginx)?.[1];
  const web = service('portal-web');

  it('is one a non-root nginx can bind', () => {
    expect(Number(listen)).toBeGreaterThanOrEqual(1024);
  });

  it('is the one compose publishes, the Dockerfile exposes and the healthcheck asks', () => {
    const published = items(web, 'ports').map((p) => /^127\.0\.0\.1:\$\{WEB_PORT:-\d+\}:(\d+)$/.exec(p)?.[1]);
    expect(published, 'one port, bound to 127.0.0.1').toEqual([listen]);
    expect(finalStage(webDockerfile)).toContain(`EXPOSE ${listen}`);
    const url = healthcheck(web).find((a) => a.startsWith('http://'));
    expect(url).toBe(`http://127.0.0.1:${listen}/`);
  });

  it('leaves the host port where it was: the one in WEB_ORIGIN, 8081 or 8082 by copy', () => {
    const host = items(web, 'ports')
      .map((p) => /\$\{WEB_PORT:-(\d+)\}/.exec(p)?.[1])
      .find(Boolean);
    const origin = service('portal-bff')
      .map((l) => /WEB_ORIGIN: \$\{WEB_ORIGIN:-http:\/\/localhost:(\d+)\}/.exec(l)?.[1])
      .find(Boolean);
    expect(['8081', '8082']).toContain(host);
    expect(host).toBe(origin);
  });
});

describe('reaching the host from the BFF (IN-25)', () => {
  it('maps host.docker.internal to the host gateway, so the name also works on Linux', () => {
    const bff = service('portal-bff');
    expect(bff.join('\n')).toContain('host.docker.internal'); // the name ZBX_URL's default uses
    expect(items(bff, 'extra_hosts')).toEqual(['host.docker.internal:host-gateway']);
  });
});
