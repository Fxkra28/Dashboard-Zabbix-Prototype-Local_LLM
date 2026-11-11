import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tokenClaims } from '../security/auth.js';

/**
 * What docker-compose.yml hands the container for sign-in: no secret of its own and no password of
 * its own, and a session cookie name that tells the two copies apart. It runs against whichever
 * copy it sits in. Plain line reading, as in compose-env.test.ts.
 */
const compose = readFileSync(fileURLToPath(new URL('../../../docker-compose.yml', import.meta.url)), 'utf8');

/** The value written for one variable in the portal-bff service, or undefined. */
function valueOf(name: string): string | undefined {
  const start = compose.split('\n').findIndex((l) => /^ {2}portal-bff:\s*$/.test(l));
  const lines = compose.split('\n').slice(start + 1);
  const env = lines.findIndex((l) => /^ {4}environment:\s*$/.test(l));
  for (const line of lines.slice(env + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (!/^ {6}\S/.test(line)) break;
    const m = new RegExp(`^ {6}${name}:\\s*(.*?)\\s*$`).exec(line);
    if (m) return m[1];
  }
  return undefined;
}

describe('docker-compose.yml, sign-in settings', () => {
  it('refuses to start without a JWT_SECRET, and never supplies one', () => {
    // ${VAR:?message} stops compose; a ${VAR:-default} would hand the BFF a secret the repo published.
    expect(valueOf('JWT_SECRET')).toMatch(/^\$\{JWT_SECRET:\?.+\}$/);
  });

  it('gives PORTAL_PASS no default, so an unset one reaches the BFF empty and is refused there, never as "admin"', () => {
    expect(valueOf('PORTAL_PASS')).toBe('${PORTAL_PASS:-}');
  });

  it('turns sign-in on unless it is told otherwise', () => {
    expect(valueOf('AUTH_ENABLED')).toBe('${AUTH_ENABLED:-true}');
  });

  it('gives this copy a session cookie name of its own, so its tokens name a portal no other copy is', () => {
    const fallback = /^\$\{SESSION_COOKIE:-([^}]+)\}$/.exec(valueOf('SESSION_COOKIE') ?? '')?.[1];
    expect(['hcml_session', 'hcml_session_ollama']).toContain(fallback);
    const other = fallback === 'hcml_session' ? 'hcml_session_ollama' : 'hcml_session';
    const [mine, theirs] = [tokenClaims(fallback!), tokenClaims(other)];
    expect(mine.iss).not.toBe(theirs.iss);
    expect(mine.aud).not.toBe(theirs.aud);
  });
});
