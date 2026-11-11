import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { webStyles } from './helpers/webStyles.js';

/**
 * The typefaces are served from this site. Nothing runs a browser against the built app here, so
 * this reads the files as text and bytes: the @font-face rules in the stylesheet (web/src/styles/), what they point at in
 * public/fonts, the licences that have to travel with the files, and the <head>.
 */
const web = (rel: string) => fileURLToPath(new URL(`../../../web/${rel}`, import.meta.url));
const css = webStyles();
const html = readFileSync(web('index.html'), 'utf8');
const fontsDir = web('public/fonts');

interface Face {
  family: string;
  weight: string;
  file: string;
  range: string;
  display: string;
}
const faces: Face[] = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
  const body = m[1];
  const pick = (re: RegExp) => re.exec(body)?.[1]?.trim() ?? '';
  return {
    family: pick(/font-family:\s*'([^']+)'/),
    weight: pick(/font-weight:\s*([^;]+);/),
    file: pick(/url\('\/fonts\/([^']+)'\)/),
    range: pick(/unicode-range:\s*([^;]+);/),
    display: pick(/font-display:\s*(\w+)/),
  };
});

describe('the @font-face rules', () => {
  it('declare Inter as one variable file per subset, covering 400 to 700, and IBM Plex Mono at 400, 500 and 600', () => {
    const inter = faces.filter((f) => f.family === 'Inter');
    const mono = faces.filter((f) => f.family === 'IBM Plex Mono');
    expect(inter.map((f) => `${f.weight} ${f.file}`).sort()).toEqual(['400 700 inter-latin-ext.woff2', '400 700 inter-latin.woff2']);
    expect(mono.map((f) => f.weight).sort()).toEqual(['400', '400', '500', '500', '600', '600']);
    expect(faces.length).toBe(inter.length + mono.length);
  });

  it('give each face a unicode-range, so a page that needs only Latin downloads only the Latin file, and swap the font in', () => {
    for (const f of faces) {
      expect(f.range, f.file).toMatch(/^U\+/);
      expect(f.display, f.file).toBe('swap');
    }
  });

  it('name families that the --sans and --mono stacks start with, or the files would never be used', () => {
    expect(/--sans:\s*'Inter',/.test(css)).toBe(true);
    expect(/--mono:\s*'IBM Plex Mono',/.test(css)).toBe(true);
  });

  it('point only at files that exist, are WOFF2 and are of a size a page can carry', () => {
    for (const f of faces) {
      const path = `${fontsDir}/${f.file}`;
      expect(existsSync(path), f.file).toBe(true);
      const bytes = readFileSync(path);
      expect(bytes.subarray(0, 4).toString('latin1'), `${f.file} is not a WOFF2 file`).toBe('wOF2');
      expect(statSync(path).size, f.file).toBeGreaterThan(3_000);
      expect(statSync(path).size, f.file).toBeLessThan(200_000);
    }
  });

  it('use every font file there is, so none is left behind to be shipped for nothing', () => {
    const used = new Set(faces.map((f) => f.file));
    const there = readdirSync(fontsDir).filter((n) => n.endsWith('.woff2'));
    expect(there.filter((n) => !used.has(n))).toEqual([]);
  });

  it('fetch nothing from another site', () => {
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/url\(\s*['"]?(?:https?:)?\/\//);
  });
});

describe('the files that travel with the fonts', () => {
  it('hold both SIL Open Font Licence texts, which the licence asks to accompany the fonts', () => {
    for (const name of ['OFL-Inter.txt', 'OFL-IBM-Plex.txt']) {
      const text = readFileSync(`${fontsDir}/${name}`, 'utf8');
      expect(text, name).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/i);
      expect(text, name).toMatch(/Copyright/);
    }
  });

  it('say where the files came from and when, and name the licence files', () => {
    const readme = readFileSync(`${fontsDir}/README.txt`, 'utf8');
    expect(readme).toMatch(/12 October 2026/);
    expect(readme).toContain('fonts.googleapis.com');
    expect(readme).toContain('OFL-Inter.txt');
    expect(readme).toContain('OFL-IBM-Plex.txt');
    for (const f of faces) expect(readme, `${f.file} is listed`).toContain(f.file);
  });
});

describe('index.html', () => {
  it('loads no stylesheet or font from anywhere, and preloads the main face from this site', () => {
    expect(html).not.toMatch(/fonts\.g(?:oogleapis|static)\.com/);
    expect(html).not.toMatch(/rel="preconnect"/);
    expect(html).not.toMatch(/rel="stylesheet"/); // the stylesheet is injected by the build, from this site
    expect(html).toMatch(/<link rel="preload" href="\/fonts\/inter-latin\.woff2" as="font" type="font\/woff2" crossorigin \/>/);
  });

  it('preloads a file that is declared, or the preload would fetch a font nothing uses', () => {
    expect(faces.some((f) => f.file === 'inter-latin.woff2')).toBe(true);
  });
});
