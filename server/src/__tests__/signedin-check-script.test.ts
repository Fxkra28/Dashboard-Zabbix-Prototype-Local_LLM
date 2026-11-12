import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * tools/live/signedin_check.py when it is started wrongly (tracker IN-78). rebuild.sh and the runbooks send the operator straight to it,
 * so a missing setting or a missing address is told in words, never as a Python traceback. Nothing here reaches a portal.
 */

const SCRIPT = fileURLToPath(new URL('../../../tools/live/signedin_check.py', import.meta.url));
const hasPython = spawnSync('python3', ['-V']).status === 0;

/** The script with only the settings given: the real ones of the shell it runs in are left out. */
function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync('python3', ['-I', SCRIPT, ...args], { encoding: 'utf8', timeout: 15_000, env: { PATH: process.env.PATH ?? '', ...env } });
  return { code: r.status, text: `${r.stdout}${r.stderr}` };
}
const noTraceback = (text: string) => {
  expect(text).not.toMatch(/Traceback|KeyError|IndexError|ValueError/);
};

describe.skipIf(!hasPython)('signedin_check.py started wrongly (IN-78)', () => {
  it('names the two settings and shows the line, when neither is set', () => {
    const r = run(['http://127.0.0.1:9']);
    expect(r.code).not.toBe(0);
    noTraceback(r.text);
    expect(r.text).toContain('PORTAL_USER and PORTAL_PASSWORD are not set');
    expect(r.text).toContain('PORTAL_USER=... PORTAL_PASSWORD=... python3 -I tools/live/signedin_check.py http://127.0.0.1:9');
  });

  it('names only the one that is missing', () => {
    const r = run(['http://127.0.0.1:9'], { PORTAL_USER: 'ana' });
    expect(r.code).not.toBe(0);
    noTraceback(r.text);
    expect(r.text).toContain('PORTAL_PASSWORD is not set');
    // The first sentence names the one that is missing; the example line that follows shows both.
    expect(r.text.split('\n')[0]).not.toContain('PORTAL_USER');
  });

  it('counts a setting that is empty as not set', () => {
    const r = run(['http://127.0.0.1:9'], { PORTAL_USER: 'ana', PORTAL_PASSWORD: '' });
    expect(r.text).toContain('PORTAL_PASSWORD is not set');
  });

  it('answers --help with the usage, exit 0, and reaches nothing', () => {
    const r = run(['--help']);
    expect(r.code).toBe(0);
    noTraceback(r.text);
    expect(r.text).toContain('PORTAL_USER=... PORTAL_PASSWORD=... python3 -I signedin_check.py');
    expect(r.text).toContain('--expect-mail');
    expect(run(['-h']).code).toBe(0);
  });

  it('shows the usage and exits 2 when there is no address at all', () => {
    const r = run([]);
    expect(r.code).toBe(2);
    noTraceback(r.text);
    expect(r.text).toContain('PORTAL_USER=... PORTAL_PASSWORD=... python3 -I signedin_check.py');
  });

  it('says that the first argument is the address, when it is something else', () => {
    const r = run(['--stream-seconds', '5'], { PORTAL_USER: 'ana', PORTAL_PASSWORD: 'x' });
    expect(r.code).not.toBe(0);
    noTraceback(r.text);
    expect(r.text).toContain('address of the portal');
  });

  it('says that --stream-seconds needs a whole number, and does not show a traceback', () => {
    const r = run(['http://127.0.0.1:9', '--stream-seconds', 'abc'], { PORTAL_USER: 'ana', PORTAL_PASSWORD: 'x' });
    expect(r.code).not.toBe(0);
    noTraceback(r.text);
    expect(r.text).toContain('--stream-seconds is a whole number');
  });

  it('answers --help wherever it stands, and starts nothing', () => {
    const r = run(['http://127.0.0.1:9', '--help'], { PORTAL_USER: 'ana', PORTAL_PASSWORD: 'x' });
    expect(r.code).toBe(0);
    expect(r.text).toContain('--expect-mail');
  });

  it('does not repeat a login that is part of the address, nor a first argument that is not an address', () => {
    const r = run(['https://ana:a-made-up-password-1234@portal.example.org']);
    expect(r.text).toContain('portal.example.org');
    expect(r.text).not.toContain('a-made-up-password-1234');
    const odd = run(['ana:a-made-up-password-1234@portal.example.org'], { PORTAL_USER: 'ana', PORTAL_PASSWORD: 'x' });
    expect(odd.code).not.toBe(0);
    expect(odd.text).not.toContain('a-made-up-password-1234');
  });

  it('never prints the password it was given', () => {
    const r = run(['http://127.0.0.1:9', '--month', 'nope'], { PORTAL_USER: 'ana', PORTAL_PASSWORD: 'a-made-up-password-1234' });
    expect(r.text).not.toContain('a-made-up-password-1234');
  });
});
