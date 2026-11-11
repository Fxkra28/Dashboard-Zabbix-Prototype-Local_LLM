import type { Tone } from './types.js';

/**
 * The portal's colours, for files that cannot read a stylesheet. The ink, the fills and the lines of
 * status are copied from the light-theme token block at the top of web/src/styles/01-tokens.css, and
 * export-theme.test.ts fails if one drifts, so a report and the screen it came from stay the same blue.
 * Reports are printed and attached to email, so they take the light theme whatever the viewer's screen uses.
 *
 * The paper is the exception. Since 26 October 2026 the screen's page and cards are one soft plane with
 * depth (DESIGN.md section 10), which a printed page cannot show and an Excel cell cannot take as a
 * translucent line, so a report keeps white paper, its own light rows and solid lines: the four
 * PAPER entries, which are not copies of a token.
 */
export const PALETTE = {
  chrome: '#0a2540',
  primary: '#2b5584',
  primaryStrong: '#1e3b5c',
  mid: '#4681c3',
  tint: '#e8eff7',
  tintLine: '#c1d5eb',
  surface: '#ffffff',
  surface2: '#f1f5f9',
  text: '#1b2733',
  muted: '#566577',
  border: '#e2e8f0',
  good: '#2e9e5b',
  goodBg: '#ecfdf3',
  goodLine: '#b7e4c7',
  goodText: '#207146',
  warn: '#e8a33d',
  warnBg: '#fff7ec',
  warnLine: '#f2ddbb',
  warnText: '#875a17',
  danger: '#e45959',
  dangerBg: '#fef2f2',
  dangerLine: '#f5c2c2',
  dangerText: '#b4352d',
  neutralBg: '#eef2f7',
  neutralText: '#475569',
} as const;

/** The report's own paper: white, light rows and solid lines, kept when the screen became a soft plane. */
export const PAPER = ['surface', 'surface2', 'tint', 'border'] as const;
type PaperKey = (typeof PAPER)[number];

/** The CSS custom property each other PALETTE entry is copied from. */
export const TOKEN_OF: Record<Exclude<keyof typeof PALETTE, PaperKey>, string> = {
  chrome: '--chrome',
  primary: '--primary',
  primaryStrong: '--primary-strong',
  mid: '--mid',
  tintLine: '--tint-line',
  text: '--text',
  muted: '--muted',
  good: '--good',
  goodBg: '--good-bg',
  goodLine: '--good-line',
  goodText: '--good-text',
  warn: '--warn',
  warnBg: '--warn-bg',
  warnLine: '--warn-line',
  warnText: '--warn-text',
  danger: '--danger',
  dangerBg: '--danger-bg',
  dangerLine: '--danger-line',
  dangerText: '--danger-text',
  neutralBg: '--neutral-bg',
  neutralText: '--neutral-text',
};

export interface ToneColours {
  /** Text colour; every one clears 4.5:1 on its own `bg`. */
  text: string;
  /** Fill behind a cell or pill. */
  bg: string;
  /** Edge of a pill, and a bar's fill colour. */
  line: string;
  /** A solid mark: a bar, a dot. */
  solid: string;
}

/** How each tone is drawn, matching the portal's status pills. */
export const TONES: Record<Tone, ToneColours> = {
  good: { text: PALETTE.goodText, bg: PALETTE.goodBg, line: PALETTE.goodLine, solid: PALETTE.good },
  warn: { text: PALETTE.warnText, bg: PALETTE.warnBg, line: PALETTE.warnLine, solid: PALETTE.warn },
  bad: { text: PALETTE.dangerText, bg: PALETTE.dangerBg, line: PALETTE.dangerLine, solid: PALETTE.danger },
  muted: { text: PALETTE.neutralText, bg: PALETTE.neutralBg, line: PALETTE.border, solid: PALETTE.muted },
  none: { text: PALETTE.text, bg: PALETTE.surface, line: PALETTE.border, solid: PALETTE.primary },
};

/** `#rrggbb` to 0 to 255 channels. */
export function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
