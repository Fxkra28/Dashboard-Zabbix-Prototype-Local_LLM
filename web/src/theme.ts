/**
 * The light theme's values, duplicated here only as fallbacks for the canvas.
 *
 * The stylesheet (src/styles/) is the source of truth: everything that can read a CSS custom property does, which is
 * what lets the dark theme exist. ECharts paints to a canvas and cannot resolve `var()`, so
 * TimeSeriesChart reads the tokens at render and falls back to these if it runs without a document.
 *
 * Keep them equal to the `:root` block: a value that drifts shows only when the page runs without a
 * document, so nobody would notice.
 */
export const theme = {
  primary: '#2B5584',
  primaryDark: '#1E3B5C',
  primaryLight: '#4681C3',
  bg: '#F4F7FB',
  surface: '#FFFFFF',
  text: '#1B2733',
  muted: '#566577',
  border: '#E2E8F0',
  good: '#2E9E5B',
  ok: '#2B5584',
};

// Zabbix severities 0..5, names + colors matching Zabbix's own palette.
export const SEVERITIES = [
  { level: 0, name: 'Not classified', color: '#97AAB3' },
  { level: 1, name: 'Information', color: '#7499FF' },
  { level: 2, name: 'Warning', color: '#FFC859' },
  { level: 3, name: 'Average', color: '#FFA059' },
  { level: 4, name: 'High', color: '#E97659' },
  { level: 5, name: 'Disaster', color: '#E45959' },
] as const;
