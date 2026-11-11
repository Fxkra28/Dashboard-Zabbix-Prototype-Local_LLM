/**
 * The design tokens of src/styles/01-tokens.css as files other tools can read: the developer handoff in
 * docs/design-system/.
 *
 *   node web/scripts/tokens.export.mjs           write the three files
 *   node web/scripts/tokens.export.mjs --check   name each file that is out of date, and exit 1
 *
 *   tokens.json           the Design Tokens Community Group format, which Tokens Studio for Figma reads:
 *                         every token of the light theme, and the dark theme's differences
 *   _tokens.scss          the same as Sass variables, with the dark theme as a map
 *   component-tokens.md   which component reads which tokens, from the rules of the stylesheet
 *
 * The stylesheet stays the only source. Nothing in these files is edited by hand, and tokens.check.mjs fails
 * when one of them no longer says what the stylesheet says. No npm dependency: the parser is tokens.check's.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseColor, parseTokens } from './tokens.check.mjs';

const STYLES = fileURLToPath(new URL('../src/styles', import.meta.url));
const OUT = fileURLToPath(new URL('../../docs/design-system', import.meta.url));
const LIGHT = ':root';
const DARK = ":root[data-theme='dark']";
const REGENERATE = 'npm run tokens:export';

/** The numbered parts joined in order, comments removed. */
function sheet() {
  const names = readdirSync(STYLES)
    .filter((name) => /^\d.*\.css$/.test(name))
    .sort();
  return names.map((name) => readFileSync(join(STYLES, name), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Split at the commas that are not inside parentheses. */
function splitTop(value) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')') depth--;
    else if (value[i] === ',' && depth === 0) {
      parts.push(value.slice(from, i).trim());
      from = i + 1;
    }
  }
  parts.push(value.slice(from).trim());
  return parts.filter(Boolean);
}

/** Replace every var(--x) with its value in this theme, falling back to the light one. */
function expand(value, theme, base, depth = 0) {
  if (depth > 10) return value;
  return value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (whole, name) => {
    const next = theme.get(name) ?? base.get(name);
    return next === undefined ? whole : expand(next, theme, base, depth + 1);
  });
}

/** The family a token belongs to, from its name, or from its value for a colour. */
function family(name, value) {
  if (/^--t-/.test(name)) return ['font-size', 'dimension'];
  if (/^--s-/.test(name)) return ['space', 'dimension'];
  if (/^--r-|^--radius$/.test(name)) return ['radius', 'dimension'];
  if (/^--dur-|^--stagger$/.test(name)) return ['motion', 'duration'];
  if (/^--ease-/.test(name)) return ['motion', 'cubicBezier'];
  if (/^--(sans|mono)$/.test(name)) return ['font', 'fontFamily'];
  if (/^--w-/.test(name)) return ['font-weight', 'fontWeight'];
  if (/^--lh-/.test(name)) return ['line-height', 'number'];
  // The format's dimension takes px or rem only, so the em tracking goes untyped.
  if (/^--track-/.test(name)) return ['letter-spacing', null];
  if (/^--(control|target)-/.test(name)) return ['size', 'dimension'];
  if (/^--z-/.test(name)) return ['z-index', 'number'];
  if (/^--bp-/.test(name)) return ['breakpoint', 'dimension'];
  if (/^--disabled-opacity$/.test(name)) return ['opacity', 'number'];
  if (/^--(e-|neu-raised|neu-inset|chrome-raised|chrome-inset|focus-ring$|shadow$)/.test(name)) return ['shadow', 'shadow'];
  if (parseColor(value)) return ['color', 'color'];
  return ['other', null];
}

function shadowLayers(value) {
  return splitTop(value).map((layer) => {
    const inset = /\binset\b/.test(layer);
    const color = /(rgba?\([^)]*\)|#[0-9a-f]{3,8})/i.exec(layer)?.[1] ?? null;
    const lengths = layer
      .replace(/\binset\b/, '')
      .replace(color ?? '', '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((l) => (l === '0' ? '0px' : l));
    const [offsetX = '0px', offsetY = '0px', blur = '0px', spread = '0px'] = lengths;
    return { color, offsetX, offsetY, blur, spread, ...(inset ? { inset: true } : {}) };
  });
}

/** One token in the community group's format. */
function dtcg(type, value) {
  if (type === 'shadow') return { $type: type, $value: shadowLayers(value) };
  if (type === 'fontFamily') return { $type: type, $value: splitTop(value).map((f) => f.replace(/^['"]|['"]$/g, '')) };
  if (type === 'cubicBezier') return { $type: type, $value: (value.match(/-?\d*\.?\d+/g) ?? []).map(Number) };
  if (type === 'number' || type === 'fontWeight') return { $type: type, $value: Number(value) };
  return type ? { $type: type, $value: value } : { $value: value };
}

/** Every token of a theme, expanded, in the order the stylesheet declares them. */
function themeTokens(theme, base) {
  const names = [...new Set([...base.keys(), ...theme.keys()])];
  return names.map((name) => [name, expand(theme.get(name) ?? base.get(name), theme, base)]);
}

function groupTokens(entries) {
  const groups = {};
  for (const [name, value] of entries) {
    const [group, type] = family(name, value);
    (groups[group] ??= {})[name.slice(2)] = dtcg(type, value);
  }
  return groups;
}

function renderJson(light, dark) {
  const lightEntries = themeTokens(light, light);
  const lightValues = new Map(lightEntries);
  const darkEntries = themeTokens(dark, light).filter(([name, value]) => lightValues.get(name) !== value);
  const doc = {
    $description: `HCML Monitoring Portal design tokens, generated from web/src/styles/01-tokens.css. Do not edit: run ${REGENERATE}. "light" holds every token; "dark" holds only the ones the dark theme changes.`,
    light: groupTokens(lightEntries),
    dark: groupTokens(darkEntries),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function renderScss(light, dark) {
  const lightEntries = themeTokens(light, light);
  const lightValues = new Map(lightEntries);
  const darkEntries = themeTokens(dark, light).filter(([name, value]) => lightValues.get(name) !== value);
  const lines = [
    `// HCML Monitoring Portal design tokens, generated from web/src/styles/01-tokens.css. Do not edit: run ${REGENERATE}.`,
    '// The light theme as variables; $hcml-dark holds the values the dark theme changes.',
    '',
    ...lightEntries.map(([name, value]) => `$hcml-${name.slice(2)}: ${value};`),
    '',
    '$hcml-dark: (',
    ...darkEntries.map(([name, value]) => `  '${name.slice(2)}': ${splitTop(value).length > 1 ? `(${value})` : value},`),
    ');',
    '',
  ];
  return lines.join('\n');
}

/** The components the handoff maps, by the selector that identifies each in the stylesheet. */
const COMPONENTS = [
  ['Page', /^body$/],
  ['Sidebar', /\.sidebar(?![\w-])/],
  ['Menu item', /\.nav-link(?![\w-])/],
  ['Logo', /\.brand-mark/],
  ['Sidebar toggle', /\.rail-toggle(?![\w-])/],
  ['Top bar', /\.topbar(?![\w-])/],
  ['Role chip', /\.role-chip(?![\w-])/],
  ['Panel and its header', /\.panel(?![\w])/],
  ['KPI card', /\.kpi(?![\w-])/],
  ['Severity tile', /\.sev-tile(?![\w-])/],
  ['Device-kind tile', /\.type-tile(?![\w-])/],
  ['Hosts-view tile', /\.kind-tile(?![\w-])/],
  ['Internet meter', /\.meter(?![\w])/],
  ['Gauge', /\.gauge-[\w-]+/],
  ['Button', /\.btn(?![\w-])/],
  ['Segmented control and tabs', /\.seg(?![\w-])/],
  ['Form field', /\.field(?![\w-])/],
  ['Text field and select', /(^|[\s>+~(])(select|input)(?![\w-])/],
  ['Theme picker', /\.theme-pick(?![\w-])/],
  ['Data table', /table\.data(?![\w-])/],
  ['Table scroller', /\.table-wrap(?![\w-])/],
  ['Severity chip', /\.badge(?![\w-])/],
  ['Status pill', /\.pill(?![\w-])/],
  ['Tag', /\.tag(?![\w-])/],
  ['Notice', /\.notice(?![\w-])/],
  ['Live marker', /\.live(?![\w-])/],
  ['Explain drawer', /\.drawer(?![\w-])/],
  ['Dialog', /\.modal(?![\w-])/],
  ['Empty, loading and error message', /\.state(?![\w-])/],
  ['Spinner', /\.spinner(?![\w-])/],
  ['Wall mode', /\.app\.wall(?![\w-])/],
];

function renderComponentMap(css) {
  const rules = [...css.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => [selector.trim().replace(/\s+/g, ' '), body])
    .filter(([selector]) => !selector.includes(':root'));
  const rows = [];
  for (const [label, pattern] of COMPONENTS) {
    const used = new Set();
    let selectors = 0;
    for (const [selector, body] of rules) {
      if (!selector.split(',').some((s) => pattern.test(s.trim()))) continue;
      selectors++;
      for (const [, name] of body.matchAll(/var\(\s*(--[\w-]+)/g)) used.add(name);
    }
    if (selectors) rows.push(`| ${label} | ${selectors} | ${[...used].sort().map((n) => `\`${n}\``).join(', ') || 'none'} |`);
  }
  return [
    '# Which component reads which tokens',
    '',
    `Generated from \`web/src/styles/\` by \`web/scripts/tokens.export.mjs\`; do not edit, run \`${REGENERATE}\`. A row`,
    'counts the rules whose selector names the component, and lists every token those rules read. The values are in',
    '[`tokens.json`](tokens.json) and [`_tokens.scss`](_tokens.scss); what each component is and does is in',
    '[`README.md`](README.md).',
    '',
    '| Component | Rules | Tokens it reads |',
    '|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

function render() {
  const css = sheet();
  const blocks = parseTokens(css);
  const light = blocks.get(LIGHT);
  const dark = blocks.get(DARK);
  if (!light || !dark) throw new Error(`tokens.export: no ${light ? DARK : LIGHT} token block in ${STYLES}`);
  return {
    'tokens.json': renderJson(light, dark),
    '_tokens.scss': renderScss(light, dark),
    'component-tokens.md': renderComponentMap(css),
  };
}

/** The files that are missing or say something else than the stylesheet: what tokens.check reports. */
export function exportProblems() {
  return Object.entries(render())
    .filter(([name, text]) => !existsSync(join(OUT, name)) || readFileSync(join(OUT, name), 'utf8') !== text)
    .map(([name]) => `docs/design-system/${name} does not match the stylesheet in web/src/styles/: run ${REGENERATE}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    const problems = exportProblems();
    for (const p of problems) console.error(p);
    if (problems.length) process.exit(1);
    console.log('tokens.export: the files in docs/design-system/ match the stylesheet');
  } else {
    mkdirSync(OUT, { recursive: true });
    for (const [name, text] of Object.entries(render())) writeFileSync(join(OUT, name), text);
    console.log(`tokens.export: wrote ${Object.keys(render()).join(', ')} in docs/design-system/`);
  }
}
