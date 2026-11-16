import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * How tools/check/facts.check.mjs counts the pages of the app from App.tsx. A route that only sends an old address to a page
 * (the old Availability address) is not a page, and the count of pages is what the documents state, so it has to be right.
 */
const repo = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const { countPages } = (await import(pathToFileURL(repo('tools/check/facts.check.mjs')).href)) as {
  countPages: (app: string) => { paths: string[]; pages: number; behindShell: number };
};

const app = (routes: string) =>
  `<Routes><Route path="/login" element={<Login />} /><Route element={<Layout />}>${routes}<Route path="*" element={<NotFound />} /></Route></Routes>`;

describe('the pages that facts.check counts in App.tsx', () => {
  it('counts every route with a path, the sign-in screen included, and not the catch-all', () => {
    const r = countPages(app('<Route path="/" element={<Overview />} /><Route path="/sla" element={<Sla />} />'));
    expect(r.paths).toEqual(['/login', '/', '/sla']);
    expect(r.pages).toBe(3);
  });

  it('does not count a route whose element only sends an old address on, whether it is named ...Redirect or is a bare Navigate', () => {
    const r = countPages(
      app(
        '<Route path="/sla" element={<Sla />} /><Route path="/old" element={<OldRedirect />} /><Route path="/older" element={<Navigate to="/sla" replace />} />',
      ),
    );
    expect(r.paths).toEqual(['/login', '/sla']);
  });

  it('counts a page whose name only contains Redirect, since the rule is about the whole word at the end', () => {
    expect(countPages(app('<Route path="/r" element={<RedirectsLog />} />')).paths).toContain('/r');
  });

  it('counts the pages behind the shell as all but the sign-in screen, and none when the app has no shell', () => {
    expect(countPages(app('<Route path="/" element={<Overview />} />')).behindShell).toBe(1);
    expect(countPages('<Routes><Route path="/login" element={<Login />} /><Route path="/" element={<Overview />} /></Routes>').behindShell).toBe(0);
  });

  it('agrees with the real App.tsx: the old Availability address is not among the pages', async () => {
    const { readFileSync } = await import('node:fs');
    const r = countPages(readFileSync(repo('web/src/App.tsx'), 'utf8'));
    expect(r.paths).not.toContain('/reports/availability');
    expect(r.paths).toContain('/sla');
  });
});
