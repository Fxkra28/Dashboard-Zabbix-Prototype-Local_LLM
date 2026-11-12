/**
 * Check the design tokens in src/styles/ (read as one sheet): that the colour pairs the UI
 * actually renders clear WCAG, and that no rule reaches past the tokens to a
 * raw value.
 *
 *   node scripts/tokens.check.mjs [file.css | folder]   (default: src/styles/, whose numbered parts are joined in order)
 *
 * Why this exists. The stylesheet held 42 distinct padding values, 16 font
 * sizes (including 10.5px, 11.5px, 12.5px and 13.5px, which round differently
 * per browser so baselines drifted between panels on one page), 14 border
 * radii and 90-odd hardcoded colours against 13 tokens. Three of those colours
 * failed WCAG and nobody knew, because nothing measured them: --muted sat at
 * 4.43:1 against the page, 0.07 short of AA, for as long as the file existed.
 *
 * A token system only holds if reaching past it fails. Both halves are checked
 * here: the contrast of every pair the interface puts together, and the
 * absence of raw values outside the token blocks.
 *
 * Contrast is computed, not asserted, so editing a token to an illegible
 * colour fails here instead of shipping. The thresholds are WCAG 2.1: 4.5:1
 * for body text, 3:1 for large text and for the boundary of a user interface
 * component (1.4.11).
 *
 * Three more things are checked, because the checker once passed while the interface
 * shipped faults it could not see:
 *
 *   - Status words. A status colour used as text must be its `-text` token: the fills
 *     (--good, --warn, --danger) fail 4.5:1 on a white panel, and so does --mid
 *     (DESIGN.md R-3). Checked in the stylesheet and in inline styles in the TSX.
 *   - The TSX files, which the stylesheet checks never saw: no raw colour, and no inline
 *     size, space, weight, line height or layer off its scale. A value that is on the scale is
 *     let through, as in the stylesheet. SVG `fontSize={n}` attributes are map units, not CSS
 *     pixels, and are not looked at.
 *   - The exceptions below, which are known and named, so a new one fails and a fixed one
 *     has to be taken off the list.
 *
 * Read-only. No npm dependency: the relative-luminance formula is six lines,
 * the same trade validate-sli.ts made with its zip reader.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** [r, g, b, a] in 0..255 / 0..1, from #rgb, #rrggbb, rgb() or rgba(). */
export function parseColor(value) {
  const v = value.trim();
  if (HEX.test(v)) {
    const h = v.slice(1);
    const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), 1];
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (fn) {
    const parts = fn[1].split(/[,/]/).map((p) => parseFloat(p));
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return [parts[0], parts[1], parts[2], Number.isFinite(parts[3]) ? parts[3] : 1];
    }
  }
  return null;
}

/** A translucent colour over an opaque one, since contrast needs what the eye gets. */
export function composite(fg, bg) {
  if (fg[3] >= 1) return fg;
  return [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
}

export function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(fg, bg) {
  const a = luminance(composite(fg, bg));
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The custom properties declared in each token block, by the selector that
 * opens it. Only blocks whose selector starts with `:root` count, so a rule
 * that happens to set a local custom property is not mistaken for a token.
 */
export function parseTokens(css) {
  const blocks = new Map();

  // Scanned rather than matched in one pass: a regex that anchored each block to the preceding "}"
  // and consumed it could not match two adjacent token blocks, so it returned the light theme alone
  // and reported every dark-mode pair as passing without having seen one. Advance by one, not by
  // the length of ":root": a following block can begin within a couple of characters of the
  // previous one's closing brace, and stepping over it loses the dark theme.
  for (let at = css.indexOf(':root'); at !== -1; at = css.indexOf(':root', at + 1)) {
    // back to the start of the selector, which is the last brace before it
    let from = at;
    while (from > 0 && css[from - 1] !== '{' && css[from - 1] !== '}' && css[from - 1] !== ';') from--;

    const open = css.indexOf('{', at);
    if (open === -1) break;
    const selector = css.slice(from, open).trim().replace(/\s+/g, ' ');
    if (!selector.includes(':root')) continue;

    const close = css.indexOf('}', open);
    if (close === -1) break;
    // A token block holds declarations only; anything nested is not one.
    const body = css.slice(open + 1, close);
    if (body.includes('{')) continue;

    const found = blocks.get(selector) ?? new Map();
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      found.set(name, value.trim());
    }
    if (found.size) blocks.set(selector, found);
    at = close;
  }
  return blocks;
}

/** Follow `var(--x)` chains inside one theme, falling back to the light theme. */
export function resolve(name, theme, base) {
  const seen = new Set();
  let value = theme.get(name) ?? base.get(name);
  while (typeof value === 'string' && value.startsWith('var(')) {
    const next = /var\(\s*(--[\w-]+)/.exec(value)?.[1];
    if (!next || seen.has(next)) return null;
    seen.add(next);
    value = theme.get(next) ?? base.get(next);
  }
  return value ?? null;
}

/**
 * Every pair the interface actually renders. `min` is 4.5 for text, 3 for a
 * component boundary or large text.
 */
export const PAIRS = [
  ['--text', '--bg', 4.5],
  // Also the graph tooltip, which the chart library paints from these two tokens and from --muted below (UX-41).
  ['--text', '--surface', 4.5],
  ['--text', '--surface-2', 4.5],
  ['--text', '--tint', 4.5],
  ['--muted', '--bg', 4.5],
  ['--muted', '--surface', 4.5],
  ['--muted', '--surface-2', 4.5],
  ['--primary', '--surface', 4.5],
  ['--primary', '--bg', 4.5],
  ['--primary', '--tint', 4.5],
  ['--on-primary', '--primary', 4.5],
  // The danger button: its fill is the danger ink.
  ['--on-primary', '--danger-text', 4.5],
  ['--on-chrome', '--chrome', 4.5],
  ['--on-chrome-2', '--chrome', 4.5],
  ['--on-chrome-3', '--chrome', 3],
  ['--good-text', '--good-bg', 4.5],
  ['--warn-text', '--warn-bg', 4.5],
  ['--danger-text', '--danger-bg', 4.5],
  ['--neutral-text', '--neutral-bg', 4.5],
  // Status words on a plain panel: the fills (--good, --danger, --warn) fail here.
  ['--good-text', '--surface', 4.5],
  ['--warn-text', '--surface', 4.5],
  ['--danger-text', '--surface', 4.5],
  // The wall screen: grey cells under a just-arrived row's tint, and a
  // late "data as of" stamp on the page background.
  ['--muted', '--tint', 4.5],
  ['--warn-text', '--bg', 4.5],
  // Status words on the hover and selected planes of a table row, and on the page plane the cards share (UX-39).
  ['--good-text', '--bg', 4.5],
  ['--danger-text', '--bg', 4.5],
  ['--good-text', '--surface-2', 4.5],
  ['--warn-text', '--surface-2', 4.5],
  ['--danger-text', '--surface-2', 4.5],
  ['--good-text', '--tint', 4.5],
  ['--warn-text', '--tint', 4.5],
  ['--danger-text', '--tint', 4.5],
  // The target beside a service's figure ('/ 99%'), on the chip of each verdict.
  ['--muted', '--good-bg', 4.5],
  ['--muted', '--warn-bg', 4.5],
  ['--muted', '--danger-bg', 4.5],
  // The logo monogram (BrandMark's fallback) on its fixed white plate.
  ['--logo-ink', '--logo-plate', 4.5],
  // Boundaries and marks, not text. DESIGN.md R-3 keeps --mid off text.
  ['--border-strong', '--surface', 3],
  ['--border-strong', '--bg', 3],
  ['--focus', '--surface', 3],
  ['--focus', '--bg', 3],
  // The sidebar's focus ring (styles/ .sidebar :focus-visible).
  ['--on-chrome', '--chrome', 3],
  ['--on-chrome', '--chrome-2', 3],
  ['--mid', '--surface', 3],
  // Plotted lines and their legend dots are graphical objects: 3:1 (1.4.11).
  ['--series-1', '--surface', 3],
  ['--series-2', '--surface', 3],
  ['--series-3', '--surface', 3],
  ['--series-4', '--surface', 3],
];

/**
 * Zabbix's six severity hues are fixed upstream and must stay exact, so what
 * is checked is the ink laid on them. All six fail as coloured text on white;
 * all six pass behind --on-severity. DESIGN.md R-4.
 */
const SEVERITY = [
  ['0 Not classified', '#97AAB3', 4.5],
  ['1 Information', '#7499FF', 4.5],
  ['2 Warning', '#FFC859', 4.5],
  ['3 Average', '#FFA059', 4.5],
  ['4 High', '#E97659', 4.5],
  // The tightest of the six, and the reason --on-severity is #08182a rather
  // than the --chrome value it started as: that measured 4.34:1 here.
  ['5 Disaster', '#E45959', 4.5],
];

export function checkContrast(blocks) {
  const problems = [];
  const base = blocks.get(':root') ?? new Map();
  if (!base.size) return ['no :root token block found'];

  for (const [selector, theme] of blocks) {
    const label = selector === ':root' ? 'light' : selector.includes('dark') ? `dark (${selector})` : selector;
    const pairs = [...PAIRS, ...SEVERITY.map(([n, hex, min]) => ['--on-severity', hex, min, n])];

    for (const [fgName, bgName, min, note] of pairs) {
      const fgRaw = resolve(fgName, theme, base);
      const bgRaw = bgName.startsWith('--') ? resolve(bgName, theme, base) : bgName;
      if (!fgRaw || !bgRaw) {
        problems.push(`${label}: ${fgName} on ${bgName} cannot be resolved`);
        continue;
      }
      const fg = parseColor(fgRaw);
      const bg = parseColor(bgRaw);
      if (!fg || !bg) continue; // gradients and keywords are not pairs
      const ratio = contrast(fg, bg);
      if (ratio + 0.005 < min) {
        const where = note ? `${fgName} on severity ${note}` : `${fgName} on ${bgName}`;
        problems.push(`${label}: ${where} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
      }
    }
  }
  return problems;
}

/**
 * A raw colour anywhere but a token block. `currentColor`, `transparent` and
 * `inherit` are not colours in this sense; nor is a colour inside a comment,
 * which the caller has already stripped.
 */
export function checkRawColors(css) {
  const problems = [];
  const lines = css.split('\n');
  let depth = 0;
  let inTokenBlock = false;
  let tokenDepth = 0;

  lines.forEach((line, i) => {
    const opensToken = /:root/.test(line) && line.includes('{');
    if (opensToken && !inTokenBlock) {
      inTokenBlock = true;
      tokenDepth = depth;
    }
    if (!inTokenBlock) {
      const found = line.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/g) ?? [];
      for (const hit of found) {
        if (/^rgba?\(/.test(hit) && !/\d/.test(hit)) continue;
        problems.push(`line ${i + 1}: ${hit.trim()} is a raw colour, use a token`);
      }
    }
    depth += (line.match(/\{/g) ?? []).length;
    depth -= (line.match(/\}/g) ?? []).length;
    if (inTokenBlock && depth <= tokenDepth) inTokenBlock = false;
  });
  return problems;
}

const msOf = (time) => parseFloat(time) * (/ms$/.test(time) ? 1 : 1000);

/** The scales in a token block: the values a raw number may take, by family. */
export function scalesOf(tokens) {
  const values = (prefix) => [...tokens].filter(([name]) => prefix.test(name)).map(([, value]) => value.trim());
  const px = (prefix) => new Set(values(prefix).filter((v) => /^\d+(\.\d+)?px$/.test(v)).map(parseFloat));
  return {
    radius: px(/^--r-/),
    size: px(/^--t-/),
    space: px(/^--s-/),
    weight: new Set(values(/^--w-/).map(Number)),
    leading: new Set(values(/^--lh-/).map(Number)),
    tracking: new Set(values(/^--track-/)),
    time: new Set(values(/^--(dur-|stagger$)/).map(msOf)),
    breakpoint: px(/^--bp-/),
  };
}

/** A value's parts, split at the spaces outside parentheses; a part holding a function (var, calc) is skipped. */
function partsOf(value) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i <= value.length; i++) {
    const c = value[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if ((c === undefined || /\s/.test(c)) && depth === 0) {
      if (i > from) parts.push(value.slice(from, i));
      from = i + 1;
    }
  }
  return parts.filter((p) => !p.includes('(') && p !== '!important');
}

const SPACE = /^(padding|margin)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^(row-|column-)?gap$/;
const TIMED = /^(transition|animation)(-duration|-delay)?$/;

/**
 * Values off their scale. A raw value equal to a step passes, as for radii and font sizes, but a
 * z-index must be a --z-* token whatever its number.
 */
export function checkRawSizes(css, tokens) {
  const scale = scalesOf(tokens);
  const problems = [];
  // The matches come in order, so the line count only ever moves forward.
  let line = 1;
  let scanned = 0;
  const lineAt = (index) => {
    for (; scanned < index; scanned++) if (css[scanned] === '\n') line++;
    return line;
  };
  for (const m of css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)) {
    const prop = m[1];
    if (prop.startsWith('--')) continue;
    const parts = partsOf(m[2].trim());
    const off = (part, what = 'the scale') => problems.push(`line ${lineAt(m.index)}: ${prop}: ${part} is not on ${what}`);
    const pxOff = (part, steps, what, hairline = false) => {
      if (!/^-?\d+(\.\d+)?px$/.test(part)) return;
      const n = Math.abs(parseFloat(part));
      if (!steps.has(n) && !(hairline && n === 1)) off(part, what);
    };
    if (/^border(-(top|bottom)-(left|right))?-radius$/.test(prop)) parts.forEach((p) => pxOff(p, scale.radius));
    else if (prop === 'font-size') parts.forEach((p) => pxOff(p, scale.size));
    // 1 px is a hairline, as in the visually hidden pattern, not a space.
    else if (SPACE.test(prop)) parts.forEach((p) => pxOff(p, scale.space, 'the spacing scale', true));
    else if (prop === 'font-weight') {
      for (const p of parts) if (/^\d+$/.test(p) && !scale.weight.has(Number(p))) off(p, 'the weights');
    } else if (prop === 'line-height') {
      for (const p of parts) {
        if (/^\d+(\.\d+)?$/.test(p) ? !scale.leading.has(Number(p)) : /\d/.test(p)) off(p, 'the line heights');
      }
    } else if (prop === 'letter-spacing') {
      for (const p of parts) if (/\d/.test(p) && p !== '0' && !scale.tracking.has(p)) off(p, 'the tracking token');
    } else if (prop === 'z-index') {
      for (const p of parts) if (/^-?\d+$/.test(p) && p !== '0') problems.push(`line ${lineAt(m.index)}: z-index: ${p} is a raw layer, use a --z-* token`);
    } else if (TIMED.test(prop)) {
      // 0.01ms is the reduced-motion near-zero: unlike 0, a transition still runs and fires its end event.
      for (const p of parts) {
        if (/^-?\d*\.?\d+m?s$/.test(p) && msOf(p) !== 0 && msOf(p) !== 0.01 && !scale.time.has(msOf(p))) off(p, 'the durations');
      }
    }
  }
  return problems;
}

/** A media query's width is a --bp-* token's: min-width at it, max-width 0.02 px under it. */
export function checkBreakpoints(css, tokens) {
  const { breakpoint } = scalesOf(tokens);
  const problems = [];
  css.split('\n').forEach((line, i) => {
    if (!line.includes('@media')) return;
    for (const m of line.matchAll(/\((max|min)-width:\s*(\d+(?:\.\d+)?)px\)/g)) {
      const at = m[1] === 'max' ? Number(m[2]) + 0.02 : Number(m[2]);
      if (![...breakpoint].some((bp) => Math.abs(bp - at) < 0.001)) {
        problems.push(`line ${i + 1}: @media (${m[1]}-width: ${m[2]}px) is not a breakpoint, use a --bp-* width (max-width 0.02px under it)`);
      }
    }
  });
  return problems;
}

/**
 * A status fill, or --mid, used as the colour of text. `color` only: borders and backgrounds
 * are marks and fills, where these tokens belong. The fills read 2.5:1 to 3.3:1 on white.
 */
const FORBIDDEN = 'good|warn|danger|mid';

const fillAsText = (token) =>
  token === '--mid'
    ? 'color: var(--mid) is for borders and icons, never text (DESIGN.md R-3)'
    : `color: var(${token}) is a fill, not a text colour, use var(${token}-text)`;

export function checkStatusText(css) {
  const problems = [];
  const re = new RegExp(`(?:^|[\\s;{])color\\s*:\\s*var\\(\\s*(--(?:${FORBIDDEN}))\\s*[,)]`);
  css.split('\n').forEach((line, i) => {
    const m = re.exec(line);
    if (m) problems.push(`line ${i + 1}: ${fillAsText(m[1])}`);
  });
  return problems;
}

/**
 * Off-scale sizes in the TSX files that are known and accepted, by file under src/ and the
 * declaration, with how many: `'features/x/X.tsx': { 'fontSize: 12.5': 1 }`. None now. An entry that no
 * longer occurs fails the check, so a size that gets fixed cannot stay on the list.
 */
export const TSX_EXCEPTIONS = {};

const stripTsxComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');

/**
 * What a TSX file does that the tokens exist to prevent. Returns [{ line, what, key }]: `key` names
 * a size so TSX_EXCEPTIONS can allow it. Comments are ignored, and so is `&#8212;`, which is not a colour.
 */
export function scanTsx(source, tokens) {
  const scale = scalesOf(tokens);
  const scales = { fontSize: scale.size, borderRadius: scale.radius };
  const found = [];
  stripTsxComments(source)
    .split('\n')
    .forEach((text, i) => {
      const line = i + 1;
      for (const hit of text.match(/(?<![&\w])#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(\s*\d/g) ?? []) {
        found.push({ line, what: `${hit.trim()} is a raw colour, use a token` });
      }
      // style={{ fontSize: 12 }} and style={{ borderRadius: '7px' }}, and font-size:12px inside a string.
      for (const m of text.matchAll(/\b(fontSize|borderRadius)\s*:\s*(['"`]?)(\d+(?:\.\d+)?)(?:px)?\2(?=\s*[,}])/g)) {
        if (!scales[m[1]].has(parseFloat(m[3]))) {
          found.push({ line, what: `${m[1]}: ${m[3]} is not on the scale`, key: `${m[1]}: ${m[3]}` });
        }
      }
      for (const m of text.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) {
        if (!scales.fontSize.has(parseFloat(m[1]))) {
          found.push({ line, what: `font-size: ${m[1]}px is not on the scale`, key: `fontSize: ${m[1]}` });
        }
      }
      // Spacing, weight, line height and layer, held to the stylesheet's scales. A computed value
      // (`12 + depth * 22`) is not looked at, and 1 px is a hairline, not a space.
      const spacing = /\b(margin|padding|gap|rowGap|columnGap)(Top|Right|Bottom|Left|Inline|Block)?\s*:\s*(['"`]?)(-?\d+(?:\.\d+)?)(?:px)?\3(?=\s*[,}])/g;
      for (const m of text.matchAll(spacing)) {
        const key = `${m[1]}${m[2] ?? ''}: ${m[4]}`;
        if (Math.abs(parseFloat(m[4])) > 1 && !scale.space.has(Math.abs(parseFloat(m[4])))) {
          found.push({ line, what: `${key} is not on the spacing scale`, key });
        }
      }
      for (const m of text.matchAll(/\bfontWeight\s*:\s*(['"`]?)(\d+)\1(?=\s*[,}])/g)) {
        if (!scale.weight.has(Number(m[2]))) found.push({ line, what: `fontWeight: ${m[2]} is not on the weights`, key: `fontWeight: ${m[2]}` });
      }
      for (const m of text.matchAll(/\blineHeight\s*:\s*(['"`]?)(\d+(?:\.\d+)?)(px)?\1(?=\s*[,}])/g)) {
        const key = `lineHeight: ${m[2]}${m[3] ?? ''}`;
        if (m[3] || !scale.leading.has(Number(m[2]))) found.push({ line, what: `${key} is not on the line heights`, key });
      }
      for (const m of text.matchAll(/\bzIndex\s*:\s*(['"`]?)(-?\d+)\1(?=\s*[,}])/g)) {
        if (m[2] !== '0') found.push({ line, what: `zIndex: ${m[2]} is a raw layer, use a --z-* token`, key: `zIndex: ${m[2]}` });
      }
      // A status fill as text: the literal forms only, a constant holding one cannot be seen from here.
      const status = new RegExp(`(?:^|[\\s{,;'"\`])color\\s*:\\s*['"\`]?var\\(\\s*(--(?:${FORBIDDEN}))\\s*[,)]`).exec(text);
      if (status) found.push({ line, what: fillAsText(status[1]) });
    });
  return found;
}

/** The problems in one TSX file, after the known exceptions are allowed for. */
export function checkTsx(source, file, tokens, exceptions = TSX_EXCEPTIONS) {
  const allowed = { ...(exceptions[file] ?? {}) };
  const problems = [];
  for (const f of scanTsx(source, tokens)) {
    if (f.key && allowed[f.key] > 0) {
      allowed[f.key]--;
      continue;
    }
    problems.push(`${file}:${f.line}: ${f.what}`);
  }
  for (const [key, left] of Object.entries(allowed)) {
    if (left > 0) problems.push(`${file}: "${key}" is listed as a known exception but is no longer there, take it off TSX_EXCEPTIONS`);
  }
  return problems;
}

function tsxFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : tsxFiles(path);
    return name.endsWith('.tsx') && !name.endsWith('.test.tsx') ? [path] : [];
  });
}

/** Fixtures first. A checker that has never failed has never been tested. */
function selfTest() {
  const fail = [];
  const eq = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) fail.push(`${label}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  };
  const near = (label, got, want) => {
    if (Math.abs(got - want) > 0.02) fail.push(`${label}: got ${got.toFixed(2)}, wanted ${want}`);
  };

  near('black on white is 21', contrast(parseColor('#000'), parseColor('#fff')), 21);
  near('white on white is 1', contrast(parseColor('#fff'), parseColor('#ffffff')), 1);
  near('the #64748b regression', contrast(parseColor('#64748b'), parseColor('#f4f7fb')), 4.43);
  near('severity 2 as text fails', contrast(parseColor('#FFC859'), parseColor('#ffffff')), 1.54);
  near('severity 2 behind ink passes', contrast(parseColor('#0a2540'), parseColor('#FFC859')), 10.11);
  near('half-alpha black over white', contrast(parseColor('rgba(0,0,0,0.5)'), parseColor('#fff')), 3.98);
  eq('short hex expands', parseColor('#fff'), [255, 255, 255, 1]);

  const css = `
:root {
  --text: #1b2733;
  --bg: #ffffff;
  --r-sm: 6px;
  --t-md: 14px;
  --alias: var(--text);
}
.a { color: #ff0000; border-radius: 7px; font-size: 14px; }
`;
  const blocks = parseTokens(css);
  eq('one token block', [...blocks.keys()], [':root']);
  eq('alias resolves', resolve('--alias', blocks.get(':root'), blocks.get(':root')), '#1b2733');

  /*
   * The regression this fixture exists for: a parser that consumed the preceding "}" found only the
   * first of these three blocks and reported every dark-mode pair as passing. A themed stylesheet
   * must yield every theme.
   */
  const themed = `
:root { --primary: #0067b1; --bg: #ffffff; }
:root[data-theme='dark'] { --primary: #3e93d6; --bg: #0d1b2a; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) { --primary: #3e93d6; --bg: #0d1b2a; }
}
.card { --local: 4px; color: red; }
`;
  const three = parseTokens(themed);
  eq('every theme is found', three.size, 3);
  eq('the dark override is read', three.get(":root[data-theme='dark']").get('--primary'), '#3e93d6');
  eq('a nested media theme is read', three.has(":root:not([data-theme='light'])"), true);
  eq('a local custom property is not a theme', [...three.keys()].some((k) => k.includes('.card')), false);
  eq('raw colour caught', checkRawColors(css).length, 1);
  eq('off-scale radius caught', checkRawSizes(css, blocks.get(':root')).length, 1);

  // Status words: a fill used as text is caught, the -text token and a border are not.
  eq('a status fill as text is caught', checkStatusText('.a { color: var(--danger); }').length, 1);
  eq('--good as text is caught after another declaration', checkStatusText('.a { padding: 0; color: var(--good) }').length, 1);
  eq('--mid as text is caught', checkStatusText('.a {\n  color: var(--mid);\n}').length, 1);
  eq('a -text token is not caught', checkStatusText('.a { color: var(--danger-text); }').length, 0);
  eq('a border in a status fill is not caught', checkStatusText('.a { border-color: var(--danger); background-color: var(--good); }').length, 0);
  eq('a status fill with a fallback is caught', checkStatusText('.a { color: var(--warn, #fff); }').length, 1);

  // The TSX files.
  const scale = new Map([['--t-sm', '12px'], ['--t-base', '13px'], ['--r-md', '10px']]);
  const tsx = (code) => scanTsx(code, scale);
  eq('a raw hex colour in TSX is caught', tsx(`const c = '#ff0000';`).length, 1);
  eq('a short hex colour in TSX is caught', tsx(`style={{ background: '#fff' }}`).length, 1);
  eq('rgba in TSX is caught', tsx(`const c = 'rgba(0, 0, 0, 0.5)';`).length, 1);
  eq('a colour in a comment is not', tsx(`// the ink is #2B5584\n/* #fff */\nconst a = 1;`).length, 0);
  eq('an entity is not a colour', tsx(`<span>&#8212;</span>`).length, 0);
  eq('a link to an anchor is not a colour', tsx(`<a href="#main">`).length, 0);
  eq('a token is not a colour', tsx(`style={{ color: 'var(--text)' }}`).length, 0);
  eq('an off-scale font size is caught', tsx(`style={{ fontSize: 12.5 }}`).length, 1);
  eq('an off-scale px string is caught', tsx(`style={{ fontSize: '17px' }}`).length, 1);
  eq('an on-scale font size is let through', tsx(`style={{ fontSize: 12 }}`).length, 0);
  eq('a size taken from the scale is let through', tsx(`style={{ fontSize: 'var(--t-base)' }}`).length, 0);
  eq('an off-scale radius is caught', tsx(`style={{ borderRadius: 7 }}`).length, 1);
  eq('font-size inside a string is checked', tsx('`<div style="font-size:12px">`').length + tsx('`<div style="font-size:15px">`').length, 1);
  eq('an svg attribute is map units, not looked at', tsx(`<text fontSize={9}>`).length, 0);
  eq('a status fill as inline text is caught', tsx(`style={{ color: 'var(--danger)' }}`).length, 1);
  eq('a status text token inline is fine', tsx(`style={{ color: 'var(--danger-text)' }}`).length, 0);
  eq('a status fill as a background is fine', tsx(`style={{ background: 'var(--danger)' }}`).length, 0);
  // Known exceptions: allowed up to their count, and a stale one is reported.
  const withTwelveFive = `<b style={{ fontSize: 12.5 }}>`;
  eq('a listed exception is allowed', checkTsx(withTwelveFive, 'x.tsx', scale, { 'x.tsx': { 'fontSize: 12.5': 1 } }).length, 0);
  eq('a second one is not', checkTsx(`${withTwelveFive}\n${withTwelveFive}`, 'x.tsx', scale, { 'x.tsx': { 'fontSize: 12.5': 1 } }).length, 1);
  eq('an exception that is gone is reported', checkTsx('const a = 1;', 'x.tsx', scale, { 'x.tsx': { 'fontSize: 12.5': 1 } }).length, 1);

  // The other scales: spacing, weight, line height, tracking, layers, durations and breakpoints.
  const steps = new Map([
    ['--s-0-5', '2px'], ['--s-1', '4px'], ['--s-2', '8px'], ['--s-3', '12px'], ['--w-semibold', '600'],
    ['--lh-body', '1.5'], ['--track-caps', '0.05em'], ['--dur-1', '120ms'], ['--bp-md', '720px'],
  ]);
  const sizes = (text) => checkRawSizes(text, steps).length;
  eq('a padding between steps is caught', sizes('.a { padding: 9px 12px; }'), 1);
  eq('a padding on the scale, raw or token, is let through', sizes('.a { padding: 8px var(--s-3); margin: 0 auto; }'), 0);
  eq('a raw part beside a token is still checked', sizes('.a { padding: var(--s-2) 28px; }'), 1);
  eq('a negative margin is held to the scale by its size', sizes('.a { margin: -4px 0; } .b { margin: -3px; }'), 1);
  eq('a hairline is not a space', sizes('.a { margin: -1px; }'), 0);
  eq('scroll padding is not spacing', sizes('.a { scroll-padding-top: 72px; }'), 0);
  eq('a raw z-index is caught, even one a token holds', sizes('.a { z-index: 5; } .b { z-index: var(--z-topbar); } .c { z-index: 0; }'), 1);
  eq('a weight off the scale is caught', sizes('.a { font-weight: 800; } .b { font-weight: 600; }'), 1);
  eq('a line height off the scale or in px is caught', sizes('.a { line-height: 1.55; } .b { line-height: 24px; } .c { line-height: normal; }'), 2);
  eq('tracking off the token is caught', sizes('.a { letter-spacing: 0.4px; } .b { letter-spacing: var(--track-caps); }'), 1);
  eq('a raw duration is caught on a continuation line', sizes('.a {\n  transition:\n    color 0.15s ease,\n    opacity var(--dur-1);\n}'), 1);
  eq('a duration on the scale and the reduced-motion near-zero pass', sizes('.a { transition: color 120ms; animation-duration: 0.01ms !important; }'), 0);
  eq('the line of a problem is the line of its property', checkRawSizes('.a {\n  color: red;\n  gap: 5px;\n}', steps), ['line 3: gap: 5px is not on the spacing scale']);
  const queries = (text) => checkBreakpoints(text, steps).length;
  eq('a max-width 0.02 px under a breakpoint passes', queries('@media (max-width: 719.98px) {}'), 0);
  eq('a max-width at the breakpoint leaves a gap and is caught', queries('@media (max-width: 720px) {}'), 1);
  eq('a min-width off the breakpoints is caught', queries('@media (min-width: 721px) {}'), 1);
  eq('a query with no width is not looked at', queries('@media (pointer: coarse) {}'), 0);
  const inline = (code) => scanTsx(code, steps).length;
  eq('an inline margin between steps is caught', inline(`style={{ marginBottom: 18 }}`), 1);
  eq('an inline margin on the scale is let through', inline(`style={{ marginTop: 8, gap: 12 }}`), 0);
  eq('a computed inline padding is not looked at', inline(`style={{ paddingLeft: 12 + depth * 22 }}`), 0);
  eq('an inline weight off the scale is caught', inline(`style={{ fontWeight: 800 }}`) + inline(`style={{ fontWeight: 600 }}`), 1);
  eq('an inline line height off the scale is caught', inline(`style={{ lineHeight: 1.55 }}`), 1);
  eq('an inline z-index is caught', inline(`style={{ zIndex: 3 }}`), 1);

  // and it must fail when a token goes illegible
  const bad = parseTokens(css.replace('--text: #1b2733;', '--text: #eeeeee;'));
  const badProblems = checkContrast(bad).filter((p) => p.includes('--text on --bg'));
  eq('an illegible --text is caught', badProblems.length > 0, true);

  return fail;
}

/** A stylesheet as one text. A folder is its numbered parts joined in order, which is the cascade a build serves. */
function readSheet(path) {
  if (!statSync(path).isDirectory()) return { raw: readFileSync(path, 'utf8'), where: (n) => `line ${n}` };
  const names = readdirSync(path).filter((name) => /^\d.*\.css$/.test(name)).sort();
  const starts = [];
  let raw = '';
  let line = 1;
  for (const name of names) {
    const text = readFileSync(join(path, name), 'utf8');
    starts.push({ name, from: line });
    raw += text;
    line += text.split('\n').length - 1;
  }
  return {
    raw,
    where: (n) => {
      const part = [...starts].reverse().find((s) => s.from <= n);
      return part ? `${part.name} line ${n - part.from + 1}` : `line ${n}`;
    },
  };
}

/** The checks, when this file is run rather than imported (tokens.export.mjs imports its parser). */
async function main() {
  const failures = selfTest();
  if (failures.length) {
    console.error(`tokens.check: the checker itself is broken, ${failures.length} self-test failure(s):`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(2);
  }

  const stylesFolder = fileURLToPath(new URL('../src/styles', import.meta.url));
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!files.length) files.push(stylesFolder);

  let total = 0;
  for (const file of files) {
    const { raw, where } = readSheet(file);
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    const blocks = parseTokens(css);
    const problems = [
      ...checkContrast(blocks),
      ...checkRawColors(css),
      ...checkRawSizes(css, blocks.get(':root') ?? new Map()),
      ...checkBreakpoints(css, blocks.get(':root') ?? new Map()),
      ...checkStatusText(css),
    ];
    for (const p of problems) console.error(`${file}: ${p.replace(/^line (\d+)/, (_, n) => where(Number(n)))}`);
    total += problems.length;

    // The TSX beside this stylesheet, against its scales. `--no-tsx` leaves it out for a stylesheet checked alone.
    if (!process.argv.includes('--no-tsx') && file.endsWith(join('src', 'styles'))) {
      const src = join(file, '..');
      for (const path of tsxFiles(src)) {
        const rel = path.slice(src.length + 1).split('\\').join('/');
        for (const p of checkTsx(readFileSync(path, 'utf8'), rel, blocks.get(':root') ?? new Map())) {
          console.error(p);
          total++;
        }
      }
    }
  }

  // The copies for the developer handoff (docs/design-system/) must say what the stylesheet says.
  if (files.length === 1 && files[0] === stylesFolder) {
    const { exportProblems } = await import('./tokens.export.mjs');
    for (const p of exportProblems()) {
      console.error(p);
      total++;
    }
  }

  if (total) {
    console.error(`tokens.check: ${total} problem(s)`);
    process.exit(1);
  }
  console.log(`tokens.check: ${files.length} file(s) OK`);
}

// Not awaited at the top level: main() imports tokens.export.mjs, which imports this file, and a top-level
// await would leave this module unfinished while that import waits for it (Node exits 13).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
}
