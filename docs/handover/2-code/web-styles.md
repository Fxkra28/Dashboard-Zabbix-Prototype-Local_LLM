# Web app: the stylesheet

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 15 min | [Web app: the pages](web-features.md) | [Tests and checkers](tests-and-checkers.md) |

The web app has no CSS framework and no styles written inside components. The look is one stylesheet in `web/src/styles/`, cut into 20 numbered parts that `index.css` imports in order. Every colour, space, size, weight, layer and duration in it comes from a token, and checks that run on every change fail a value that reaches past the tokens. This chapter says how the parts are ordered, what the tokens are, how dark mode works, and what is checked. How the interface is meant to look, and why, is in `DESIGN.md`, and the handoff for designers is in `docs/design-system/`.

## The parts and the cascade

<!-- gen:snippet web/src/styles/index.css#L9-28 sha=16a5e2d49aed -->
`web/src/styles/index.css:9-28`

```css
@import './00-fonts.css';
@import './01-tokens.css';
@import './02-base.css';
@import './03-shell.css';
@import './04-login.css';
@import './05-layout-chips-tags.css';
@import './06-cards-tables-badges.css';
@import './07-controls-states.css';
@import './08-explain-modal-notices.css';
@import './09-reports-sites.css';
@import './10-assistant.css';
@import './11-graphs-network.css';
@import './12-sla-services-links.css';
@import './13-second-pass.css';
@import './14-sidebar-wall.css';
@import './15-report-download.css';
@import './16-meters.css';
@import './17-hosts-devices.css';
@import './18-soft-depth.css';
@import './19-touch.css';
```
<!-- /gen -->

1. The parts are slices of one file, and their order is the cascade: a rule that beats an earlier one stays after it. So a new rule goes into the part it belongs to, and a new part takes the next number. `stylesheet.test.ts` fails when the list in `index.css` and the files beside it disagree, when a number is skipped or repeated, or when the tokens do not come before everything that uses them. A build serves the parts as one sheet.
2. The fonts come first and the tokens second. The fonts are served from this site, so nothing is fetched from outside.

| Part | What it holds |
|---|---|
| `00-fonts.css` | The two typefaces, Inter and IBM Plex Mono |
| `01-tokens.css` | The design tokens, for light and dark |
| `02-base.css` | The reset and the one visible focus ring |
| `03-shell.css` | The page grid: sidebar, top bar and content |
| `04-login.css` | The sign-in card |
| `05-layout-chips-tags.css` | The two-column layout, severity chips, problem tags and the skip link |
| `06-cards-tables-badges.css` | Panels, figure cards, tables and pills |
| `07-controls-states.css` | Buttons, fields, filters and the loading, error and empty states |
| `08-explain-modal-notices.css` | The Explain slide-over, modal dialogs, notices and the role chip |
| `09-reports-sites.css` | The scorecard, alert-noise flags, links, ageing, the service tree and the site cards |
| `10-assistant.css` | The Assistant's chat |
| `11-graphs-network.css` | The Graphs, Latest data and Network pages |
| `12-sla-services-links.css` | The SLA, services, availability, capacity, sites and links pages |
| `13-second-pass.css` | Fixes found on a second pass: freshness, errors, links in tables, focus and page details |
| `14-sidebar-wall.css` | The collapsible sidebar, the theme picker and the wall mode |
| `15-report-download.css` | The SLA download buttons |
| `16-meters.css` | The Dashboard's tabs and the internet traffic meters |
| `17-hosts-devices.css` | The Dashboard's Hosts view |
| `18-soft-depth.css` | The soft look of 26 October: raised and pressed surfaces, the 3:1 edges and the motion |
| `19-touch.css` | Makes every control at least 44 pixels where the pointer is a finger |

## The tokens

`web/src/styles/01-tokens.css` holds every value the rest may use. Two rules govern it. Every colour used below comes from here, which is what makes dark mode a matter of redefining tokens and nothing else. And every space, size, weight, layer and duration comes from a scale here: `tokens.check` fails a value that sits between the steps.

<!-- gen:snippet web/src/styles/01-tokens.css#L81-128 sha=5c2639223c49 -->
`web/src/styles/01-tokens.css:81-128`

```css
--r-xs: 4px;
--r-sm: 6px;
--r-md: 10px;
--r-lg: 14px;
--r-xl: 22px;
--r-pill: 999px;

/* The 4 px grid, with half steps under 12 px, where 2 px is a large share of a gap. */
--s-0-5: 2px;
--s-1: 4px;
--s-1-5: 6px;
--s-2: 8px;
--s-2-5: 10px;
--s-3: 12px;
--s-4: 16px;
--s-5: 20px;
--s-6: 24px;
--s-7: 28px;
--s-8: 32px;
--s-10: 40px;
--s-12: 48px;

/* No fractional sizes. 12.5px and 13.5px rounded differently per browser and
   per zoom, so baselines drifted between adjacent panels on one page. */
--t-xs: 11px;
--t-sm: 12px;
--t-base: 13px;
--t-md: 14px;
--t-lg: 15px;
--t-xl: 18px;
--t-2xl: 24px;
--t-3xl: 30px;
--t-4xl: 44px;

/* Inter is served from 400 to 700, so a heavier weight would draw as 700 anyway. */
--w-regular: 400;
--w-medium: 500;
--w-semibold: 600;
--w-bold: 700;

/* A figure set solid, a short label, running text, and text read at length. */
--lh-solid: 1;
--lh-tight: 1.2;
--lh-body: 1.5;
--lh-loose: 1.6;

/* Uppercase labels, spaced in em so the spacing follows the size. */
--track-caps: 0.05em;
```
<!-- /gen -->

1. One hue, five roles. The portal's own colour is one blue in a few shades (`--chrome`, `--primary`, `--primary-strong`, `--mid`, `--tint`), and there is never a second hue, because severity owns the loud colours. A chart is the one place that allows another: `--series-1` to `--series-4`, none of them in severity's warm range, so a plotted line is never mistaken for an alarm.
2. Spacing is a 4 pixel grid with half steps under 12 pixels, where 2 pixels is a large share of a gap. Type has no fractional sizes: 12.5 and 13.5 pixels rounded differently for each browser and each zoom, so baselines drifted between neighbouring panels on one page.
3. Inter is served from 400 to 700, so a heavier weight would draw as 700 anyway, and the scale stops there. Line heights have four names, for a figure set solid, a short label, running text and text read at length.
4. The status colours come in sets, such as `--good`, `--good-bg`, `--good-line` and `--good-text`. The fill is for a pill or a dot. The `-text` one is for words, since the fills fail 4.5:1 as text on a panel. `tokens.check` fails a status colour used as text that is not its `-text` token, in the stylesheet and in the inline styles of the components.
5. `--border` draws dividers, where nothing depends on seeing it. Anything whose edge identifies it as a control uses `--border-strong`, which clears the 3:1 that WCAG 1.4.11 asks of a component boundary.

<!-- gen:snippet web/src/styles/01-tokens.css#L130-151 sha=bc3f4ff1c861 -->
`web/src/styles/01-tokens.css:130-151`

```css
/* No target is under 24 px (WCAG 2.5.8), and none under 44 px for a finger (19-touch.css). */
--control-sm: 28px;
--control-md: 36px;
--target-min: 24px;
--target-touch: 44px;
--disabled-opacity: 0.5;

/* Lowest first. The first three count only inside their own box: sticky table cells, the rail toggle. */
--z-raise: 1;
--z-head: 2;
--z-corner: 3;
--z-topbar: 5;
--z-sidebar: 7;
--z-overlay: 50;
--z-skip: 1000;

/* A media query cannot read these, so queries write the number, max-width 0.02 px under it;
   tokens.check holds every query to this list. */
--bp-sm: 640px;
--bp-md: 720px;
--bp-lg: 900px;
--bp-xl: 1100px;
```
<!-- /gen -->

1. No target is under 24 pixels (WCAG 2.5.8), and none under 44 for a finger. `--control-sm` and `--control-md` are the heights of controls on a desktop, and `--target-touch` is what `19-touch.css` uses.
2. The layers are lowest first. The first three count only inside their own box: sticky table cells, the rail toggle. Above them are the top bar, the sidebar, the overlay and the skip link.
3. A media query cannot read a custom property, so a query writes the number, and writes it 0.02 pixels under the breakpoint (`max-width: 719.98px`), which leaves no gap at a fractional width under zoom. `tokens.check` holds every query to the `--bp-*` list, and a test holds the sidebar's own query in `useUiPrefs.ts` to the token.

## Dark mode

<!-- gen:snippet web/src/styles/01-tokens.css#L203-215 sha=8499542af0f9 -->
`web/src/styles/01-tokens.css:203-215`

```css
:root[data-theme='dark'] {
  color-scheme: dark;

  --chrome: #081320;
  --chrome-2: #102a41;
  --primary: #6d9bcf;
  --primary-strong: #84abd7;
  --mid: #84abd7;
  --tint: #19324d;
  --tint-line: #23456c;

  --bg: #14263a;
  --surface: #14263a;
```
<!-- /gen -->

1. Dark mode is the same tokens with other values. `:root[data-theme='dark']` is the explicit choice, written to the page by `useTheme` (in `useUiPrefs.ts`) and remembered in `localStorage` under `hcml.theme`. A second block, inside `@media (prefers-color-scheme: dark)` and keyed on `:root:not([data-theme='light'])`, is the system's choice, which applies until someone picks a side. The `system` setting removes the attribute, so the media block decides.
2. The stored theme must be on the page before the first paint, or a page opens in the computer's colours and then fades over. `public/theme.js` does it, as a file and not as inline code, because the content-security policy allows no inline script. `themeBeforePaint.test.ts` holds the key it reads equal to the one `useTheme` writes.
3. Two near-blacks cannot be told apart by their contrast ratio: the WCAG formula adds 0.05 to both luminances, so every pair in the navy family lands between 1.05 and 1.14 however far apart they look. So the dark planes are separated by `--border` and by depth, and not by a step in luminance.
4. A trap: the dark values are written twice, once in each block, and nothing checks that the two are equal. `tokens.check` reads all three blocks and measures the contrast of each, so a bad value in either is caught, but a value changed in one block and not the other is not. A new colour goes into the light block and into both dark blocks, as the design system's rules say. At the time of writing the two blocks hold the same 46 properties with the same values.
5. A canvas cannot read a custom property. `TimeSeriesChart` reads the tokens at render, and `theme.ts` holds the light values as a fallback for a render without a document.

## Focus, touch and motion

<!-- gen:snippet web/src/styles/02-base.css#L6-14 sha=997d0e7d85eb -->
`web/src/styles/02-base.css:6-14`

```css
:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: var(--r-xs);
}
/* On the dark sidebar the brand-blue ring is 2.02:1; white clears 3:1 on both chrome shades (1.4.11). */
.sidebar :focus-visible {
  outline-color: var(--on-chrome);
}
```
<!-- /gen -->

<!-- gen:snippet web/src/styles/19-touch.css#L1-26 sha=b454908ecf15 -->
`web/src/styles/19-touch.css:1-26`

```css
/* Where the pointer is a finger, no control is under 44 px; desktops and the wall keep their density.
   A query adds no specificity, so each selector is as specific as the rule that sized the control. */
@media (pointer: coarse) {
  button.btn,
  a.btn,
  button.btn.sm,
  a.btn.sm,
  select,
  .theme-pick select,
  input[type='text'],
  input[type='password'],
  input[type='datetime-local'],
  .seg button,
  .nav-link,
  .nav-section-title,
  .skip-link,
  .chat-suggest,
  .item-row,
  .sla-item,
  .check,
  .filter-check {
    min-height: var(--target-touch);
  }
  .seg button {
    min-width: var(--target-touch);
  }
```
<!-- /gen -->

<!-- gen:snippet web/src/styles/01-tokens.css#L327-337 sha=bac54a1cd5b9 -->
`web/src/styles/01-tokens.css:327-337`

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

```
<!-- /gen -->

1. There is one focus ring for every control, drawn outside the element so a tight table cell cannot clip it. `:where` keeps its specificity at zero, so any rule can restyle it. A rule that sets `outline: none` with nothing in its place leaves a keyboard user unable to tell where they are, which is why the only one is for `main`, which takes focus only as the skip link's target. On the dark sidebar the brand-blue ring is 2.02:1, so there it is white, which clears 3:1 on both shades of the chrome.
2. Where the pointer is a finger (`pointer: coarse`), no control is under 44 pixels, and desktops and the wall keep their density. A query adds no specificity, so each selector in the list is as specific as the rule that sized the control, and the list has to be extended when a new kind of control is added.
3. A person who asks the system to stop animating things is not asking for a shorter animation. The reduced-motion block makes every animation and transition effectively instant. The exceptions are state and not decoration, such as the spinner's turn and the live cursor, and are handled at their own rules.
4. Since 26 October 2026 the page and its cards are one soft plane, separated by depth and not by a colour step. What stands above the page is raised (`--neu-raised`), and what takes input or shows a choice is pressed in (`--neu-inset`). Controls keep their `--border-strong` edge anyway, because a shadow alone measured 1.20 to 1.59:1. `18-soft-depth.css` holds those rules.

## What is checked

| Check | What it guards | Run by |
|---|---|---|
| `web/scripts/css.check.mjs` | The sheet is structurally sound: every block closed, no stray brace, no rule opened inside another, no declaration outside a rule. Vite's build does not fail on any of these, and one lost brace once left about 50 rules in one portal silently unapplied | `npm run check:styles` |
| `web/scripts/tokens.check.mjs` | Every colour pair the interface puts together clears WCAG, text at 4.5:1 and a control's edge at 3:1, computed and not asserted. No raw colour outside the token blocks, no space, size, weight, line height or layer off its scale, in the stylesheet and in the inline styles of the components, and every media query on a breakpoint | `npm run check:styles` |
| `web/scripts/tokens.export.mjs` | Writes `docs/design-system/tokens.json`, `_tokens.scss` and `component-tokens.md` from the stylesheet. With `--check` it names a file that is out of date, and `tokens.check` fails when one is | `npm run tokens:export` |
| `stylesheet.test.ts` | The parts and `index.css` agree, and the cascade order holds | `npm test` |

Before the check was added the stylesheet held 42 distinct padding values, 16 font sizes and 14 border radii, and 90-odd hard-coded colours against 13 tokens. Three of those colours failed WCAG and nobody knew, because nothing measured them: `--muted` sat at 4.43:1 against the page, 0.07 short of the 4.5 that AA asks, for as long as the file had existed. The checker has no npm dependency. The relative-luminance formula is six lines.
