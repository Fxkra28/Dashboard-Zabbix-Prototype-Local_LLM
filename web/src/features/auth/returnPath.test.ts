import { describe, expect, it } from 'vitest';
import { returnPath } from './Login';

/** returnPath reads ?next= the way goToSignIn (api/session.ts) writes it: URI-encoded. */
const after = (next: string) => returnPath(`?next=${encodeURIComponent(next)}`);

describe('returnPath: where sign-in goes next', () => {
  it('returns to a page on this site, query string included', () => {
    expect(after('/problems?severity=5')).toBe('/problems?severity=5');
    expect(after('/?wall=1')).toBe('/?wall=1');
  });

  it('goes home when there is no next page', () => {
    expect(returnPath('')).toBe('/');
    expect(returnPath('?next=')).toBe('/');
  });

  it('never leaves the site', () => {
    for (const next of ['//evil.example', '/\\evil.example', 'https://evil.example', 'evil.example', 'javascript:alert(1)']) {
      expect(after(next), next).toBe('/');
    }
  });

  it('keeps an encoded slash as a path on this site', () => {
    // The browser reads %2F%2F as part of the path, not as another host.
    expect(after('/%2F%2Fevil.example')).toBe('/%2F%2Fevil.example');
  });

  it('refuses control characters', () => {
    expect(after('/problems\nx')).toBe('/');
    expect(after('/\tproblems')).toBe('/');
  });

  it('does not come back to the sign-in page, however it is spelled', () => {
    for (const next of ['/login', '/LOGIN', '/login/', '/login/x', '/%6Cogin', '/Login?next=/']) {
      expect(after(next), next).toBe('/');
    }
    expect(after('/logins')).toBe('/logins');
  });
});
