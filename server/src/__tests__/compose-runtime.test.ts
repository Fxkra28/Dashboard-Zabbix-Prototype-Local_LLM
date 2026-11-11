import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** docker-compose.yml's runtime keys for the BFF, read line by line as compose-env.test.ts does. */
const compose = readFileSync(fileURLToPath(new URL('../../../docker-compose.yml', import.meta.url)), 'utf8').split('\n');
const dockerfile = readFileSync(fileURLToPath(new URL('../../Dockerfile', import.meta.url)), 'utf8').split('\n');

/** A service's own lines, from its key to the next service. */
function service(name: string): string[] {
  const start = compose.findIndex((l) => l === `  ${name}:`);
  expect(start, `a ${name} service`).toBeGreaterThanOrEqual(0);
  const rest = compose.slice(start + 1);
  const end = rest.findIndex((l) => /^ {2}\S/.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

const code = (lines: string[]) => lines.filter((l) => !/^\s*#/.test(l));

describe('portal-bff in docker-compose.yml', () => {
  const bff = code(service('portal-bff'));

  it('passes every build argument the Dockerfile takes, defaulting to unknown, so /api/health can show the build (IN-01)', () => {
    const takes = dockerfile.filter((l) => l.startsWith('ARG ')).map((l) => l.slice(4).split('=')[0]);
    expect(takes.sort()).toEqual(['BUILD_COMMIT', 'BUILD_TIME']);
    const args = bff.findIndex((l) => l === '      args:');
    expect(args, 'a build.args block').toBeGreaterThan(bff.findIndex((l) => l === '    build:'));
    for (const name of takes) {
      expect(bff, name).toContain(`        ${name}: \${${name}:-unknown}`);
    }
  });

  it('runs under an init process, so SIGTERM reaches node and zombies are reaped (BK-06)', () => {
    expect(bff).toContain('    init: true');
  });

  it('checks the process by asking the port it listens on for /api/health, and nothing about Zabbix (IN-09)', () => {
    const port = bff.map((l) => /^ {6}PORT: "(\d+)"$/.exec(l)?.[1]).find(Boolean);
    expect(port, 'PORT in the environment').toBeDefined();
    const at = bff.findIndex((l) => l === '    healthcheck:');
    expect(at, 'a healthcheck').toBeGreaterThan(-1);
    const rest = bff.slice(at + 1);
    const end = rest.findIndex((l) => /^ {4}\S/.test(l));
    const block = (end === -1 ? rest : rest.slice(0, end)).join('\n');
    expect(block).toContain(`http://127.0.0.1:${port}/api/health`);
    expect(block).toContain('r.ok ? 0 : 1'); // the status code only: `ready` in the body must not fail it
    expect(block).not.toMatch(/ready|zabbix/i);
    // Only a signed-in caller gets `ready`, the build and the screens: the check sends no credential and reads no body.
    expect(block).not.toMatch(/\.(json|text)\(|authorization|cookie|bearer/i);
    expect(block).toMatch(/start_period: \d+s/); // a slow boot is not a failure
  });
});

describe('portal-web in docker-compose.yml', () => {
  it('waits for the BFF to be healthy, not only started (IN-09)', () => {
    const web = code(service('portal-web')).join('\n');
    expect(web).toMatch(/depends_on:\n {6}portal-bff:\n {8}condition: service_healthy/);
  });
});
