# Design system

How the portal's interface is put together, for whoever maintains it: where each decision lives, the rules a change
has to keep, every component with its variants, states and accessibility, and how to hand the tokens to a designer or
another project.

| Layer | Where | Who changes it |
|---|---|---|
| Direction | [`DESIGN.md`](../../DESIGN.md): identity, palette, type, mood dials, and the measurements behind them | the portal's owner; a change starts there |
| Tokens | [`web/src/styles/01-tokens.css`](../../web/src/styles/01-tokens.css): every colour, size, radius, shadow and duration, for both themes | a developer, against `DESIGN.md` |
| Rules | the numbered parts in [`web/src/styles/`](../../web/src/styles/), joined in order by `index.css` | a developer |
| Components | React in `web/src/shared/components/` and `web/src/features/` | a developer |
| Handoff | [`tokens.json`](tokens.json), [`_tokens.scss`](_tokens.scss), [`component-tokens.md`](component-tokens.md) in this folder | nobody by hand: `npm run tokens:export` writes them |

## The rules a change keeps

1. **A value is a token.** `tokens.check.mjs` fails a raw colour outside the token blocks; a space, radius, font
   size, weight, line height, tracking or duration between the steps of its scale; a z-index that is not a `--z-*`
   token; and a media query off the breakpoints. A new colour goes into `01-tokens.css`, in the light block and in
   both dark blocks.
2. **Text and edges are measured.** Text clears 4.5:1 and the edge of a control 3:1, in both themes. The checker
   computes every pair in its list; when a new colour sits under text, add the pair there.
3. **Depth means something.** The page and its cards are one plane (since 26 October 2026, `DESIGN.md` section 10).
   What stands above the page is raised (`--neu-raised*`); what takes input or shows a choice is pressed in
   (`--neu-inset*`). A control also keeps its 1px edge in `--border-strong`, because a shadow alone is not 3:1.
4. **Severity is the only loud colour.** Zabbix's six severities appear as filled chips with the `--on-severity`
   ink, never as coloured text, and nothing else borrows their hues.
5. **Motion answers something.** Durations come from the `--dur-*` tokens and `--ease-out`. Only state loops (the
   spinner and the streaming cursor), wall mode turns the rest off, and the reduced-motion rule in `01-tokens.css`
   stops all of it.
6. **A finger gets 44 px.** No target is under 24 px (WCAG 2.5.8). Where the pointer is coarse, a tablet or a phone,
   `19-touch.css` makes every control at least 44 px; a new control goes into its list. There a select is drawn without its
   native look, with an arrow drawn in its text colour, because WebKit keeps a native select at its own height.
7. **Both themes, every time.** Look at a change in light and in dark; the theme picker in the top bar switches
   between light, dark and the system's choice.
8. **After a token change**, run `npm run tokens:export`, then `npm run check:styles`, which fails while the files in
   this folder say something other than the stylesheet.

## Tokens

The values are in [`tokens.json`](tokens.json) and [`_tokens.scss`](_tokens.scss); this is what each family is for.

| Family | Tokens | For |
|---|---|---|
| Chrome and brand | `--chrome`, `--chrome-2`, `--on-chrome`, `--on-chrome-2`, `--on-chrome-3`, `--primary`, `--primary-strong`, `--mid`, `--tint`, `--tint-line` | the navy sidebar and its text, the HCML blue ramp, the selected row |
| Surfaces and text | `--bg`, `--surface`, `--surface-2`, `--text`, `--muted`, `--on-primary` | the soft plane, the pressed-in well, body and secondary text |
| Status | `--good`, `--warn`, `--danger`, each with `-bg`, `-line` and `-text`; `--neutral-bg`, `--neutral-text` | pills, notices and words that report a state |
| Severity | `--on-severity` (the ink); the six fills are Zabbix's own colours | severity chips |
| Lines | `--border` (dividers), `--border-strong` (the 3:1 edge of a control), `--focus`, `--focus-ring` | dividers, control edges, keyboard focus |
| Charts | `--series-1` to `--series-4` | the four lines a chart can tell apart; none is a severity hue |
| Depth | `--neu-raised`, `--neu-raised-sm`, `--neu-raised-xs`, `--neu-inset`, `--neu-inset-sm`, `--chrome-raised`, `--chrome-inset`, `--chrome-well`, `--e-1` to `--e-3`, `--e-drawer`, `--scrim`, `--shadow` | raised and pressed surfaces, depth on the chrome, the drawer and dialog layers |
| Type | `--sans` (Inter), `--mono` (IBM Plex Mono), `--t-xs` to `--t-4xl` (11 to 44 px) | text; the mono face for anything compared down a column |
| Weight | `--w-regular`, `--w-medium`, `--w-semibold`, `--w-bold` (400 to 700) | Inter is served from 400 to 700, so nothing heavier |
| Line height | `--lh-solid` (1), `--lh-tight` (1.2), `--lh-body` (1.5), `--lh-loose` (1.6) | a figure set solid, a short label, running text, text read at length |
| Tracking | `--track-caps` (0.05em) | uppercase labels |
| Space | `--s-0-5` to `--s-12` (2 to 48 px): the 4 px grid, with half steps of 2, 6 and 10 px | padding, margins and gaps |
| Controls | `--control-sm` (28 px), `--control-md` (36 px), `--target-min` (24 px), `--target-touch` (44 px), `--disabled-opacity` | the heights of buttons, fields and segmented options; the smallest target; a finger's target; the disabled look |
| Radius | `--r-xs`, `--r-sm`, `--r-md`, `--r-lg`, `--r-xl`, `--r-pill`, `--radius` | corners by role: chips are pills, controls `--r-lg`, cards `--r-xl` |
| Layers | `--z-raise`, `--z-head`, `--z-corner` (inside their own box), `--z-topbar`, `--z-sidebar`, `--z-overlay`, `--z-skip` | which layer is above which, lowest first |
| Breakpoints | `--bp-sm` to `--bp-xl` (640, 720, 900, 1100 px) | the widths layouts change at; a media query cannot read a custom property, so it writes the number (max-width 0.02 px under it) and the checker holds it to these |
| Motion | `--dur-1` to `--dur-4`, `--stagger`, `--ease-out`; `--dur-spin`, `--dur-blink`, `--dur-highlight` | transitions and the one rise of a page's content; the spinner, the streaming cursor and the wall's highlight |
| Brand file | `--logo-plate`, `--logo-ink` | the white plate the original logo needs, and the monogram shown if it fails |

## Components

[`component-tokens.md`](component-tokens.md) lists the tokens each one reads.

### Foundations

| Component | Where | Notes |
|---|---|---|
| Icons | `shared/components/icons.tsx` | Inline SVG drawn in `currentColor`, hidden from screen readers (`aria-hidden`), always beside a label that names the control |
| Logo | `shared/components/BrandMark.tsx`, `.brand-mark` | Three variants: `lockup` (the original on its white plate: sign-in card), `lockup-white` (the same in white on the chrome: the expanded sidebar), `icon` (the H: the rail, the favicon, the wall). Falls back to an "HC" monogram, named for screen readers, when the image fails |
| Fonts | `web/public/fonts`, `--sans`, `--mono` | Served by the portal, not a font service |

### Controls

| Component | Where | Variants and states | Accessibility |
|---|---|---|---|
| Button | `.btn` on a `button` or an `a` | primary (the default, filled blue), `ghost` (outlined with the 3:1 edge), `danger` (for what the portal cannot take back), size `sm`; 36 px, or 28 px for `sm`; raised, lifts on hover, presses in when used; disabled is dimmed and does neither | a real `button` or link; `type="button"` unless it submits; the focus ring is the global `:focus-visible` outline |
| Text field and select | `select`, `input`, inside `Field` (`shared/components/Field.tsx`) | 36 px; pressed in with the 3:1 edge; `:focus` adds the focus ring; disabled is dimmed | `Field` puts a `label` above its control (`htmlFor`); `FieldGroup` for a group of buttons, `FieldSpacer` for a cell with nothing to label |
| Segmented control and tabs | `.seg`; `features/dashboard/Tabs.tsx` | a pressed-in track; options 28 px, the page tabs (`.dash-tabs`, `.sli-tabs`) 36 px; the chosen option (`.on`) is raised | as tabs: `role="tablist"` and `tab`, `aria-selected`, `aria-controls`; the arrow keys move between them |
| Device-kind tile | `.type-tile` (Devices) | raised; the chosen one is pressed in; a kind with no devices is disabled | a `button` with `aria-pressed` |
| Checkbox | `.check` (a `label` around its `input`) | a disabled one keeps its words readable in `--muted`, since one of them says why | the label is the target, so the whole line toggles it |
| Theme picker | `.theme-pick select` (top bar) | light, dark, system; 28 px; the choice is on `<html>` before the first paint (`web/public/theme.js`), so a page opens in it and only a switch fades | a labelled `select` |
| Pager | `shared/components/Pager.tsx` | Previous and Next as `btn ghost sm`, disabled at either end | the line between them says where the list stands |

### Indicators

| Component | Where | Notes |
|---|---|---|
| Severity chip | `SeverityBadge` in `StatusBadge.tsx`, `.badge` | Zabbix's fill with the `--on-severity` ink, 5.00:1 or better on all six |
| Status pill | `UpDown` and the status pills, `.pill` with a `.dot` | always a word (Up, Down, Unknown) beside the colour, so colour is never the only signal |
| Tag | `.tag` | Zabbix tags and labels on a tint |
| Role chip | `.role-chip` (top bar) | the signed-in role |
| Live marker | `.live` | the stream's state, with its word |
| Notice | `.notice`, `.notice.warn` | a boxed status message (`role="status"`), as in the Problems list and the Acknowledge dialog |
| No data | `shared/components/NoData.tsx` | "—" for the eye, hidden from screen readers, and "No data" for them |

### Surfaces and data

| Component | Where | Notes |
|---|---|---|
| Panel | `.panel`, `.panel-head` | raised; the header holds the title and, on the right, its time or action |
| KPI card | `KpiCard.tsx`, `.kpi` | label, value and an optional line under it; the left stripe takes `accent` where a state sets it (for example `var(--danger)`), and a card with no state has none |
| Severity tile | `.sev-tile` | a severity and its count |
| Hosts-view tile | `.kind-tile` | a device kind, as a link to its list |
| Internet meter and gauge | `.meter`; `features/meters/Gauge.tsx` | the dial is drawn for the eye and hidden from screen readers; `role="meter"` carries the value and its zone in words |
| Data table | `table.data` inside `TableWrap` (`shared/components/TableWrap.tsx`) | `TableWrap` gives the box a tab stop and a name only while the table scrolls; the last column can stay in view (`sticky-end`); a selected row has a bar on its left; a row that appears or clears is highlighted briefly |
| States | `shared/components/states.tsx`, `.state` | `Loading` (`role="status"`, a spinner), `ErrorState` (`role="alert"`, what to check), `Empty` (why it is empty), `RefreshFailed` (the last good data stays, with its age) |

### Overlays

| Component | Where | Notes |
|---|---|---|
| Explain drawer | `features/assistant/ExplainPanel.tsx`, `.drawer` | `role="dialog"` with `aria-modal`, closes with Escape or a click on the dimmed page; its long text is a scrollable region with a tab stop |
| Dialog | `features/problems/AckDialog.tsx`, `.modal` | `role="dialog"`, `aria-modal`, named by its heading; Escape closes it; focus moves in and comes back; its messages are `status` and `alert`; Confirm becomes the danger button while Close problem is ticked |

### Layout

| Component | Where | Notes |
|---|---|---|
| Shell | `features/shell/Layout.tsx` | a skip link to the main content, the top bar as the header, the sidebar, the main region |
| Sidebar | `features/shell/Sidebar.tsx`, `.sidebar` | a `nav` with groups that fold (`aria-expanded`); the toggle makes it a rail of icons, which the Dashboard starts as and a window under 720 px keeps; the build label sits in its footer |
| Wall mode | `.app.wall` | full screen, no chrome, views that turn by themselves; nothing rises or lifts, and a problem that appears or clears keeps its highlight |
| Sign-in | `features/auth/Login.tsx` | the original logo on its plate, labelled fields, the error as `role="alert"` |

## Handing the tokens over

- **Figma.** In Tokens Studio, load [`tokens.json`](tokens.json). It has two sets: `light` holds every token and `dark`
  only what the dark theme changes, so apply `light` and then `dark` on top. The file follows the Design Tokens
  Community Group format (`$type`, `$value`), and a shadow is a list of its layers.
- **Sass.** Copy [`_tokens.scss`](_tokens.scss) into the other project and `@use` it: the light theme is `$hcml-<name>`
  (for example `$hcml-primary`), and the dark theme is the map `$hcml-dark`, read with `map.get($hcml-dark, 'primary')`.
- **This repository.** Use the custom properties (`var(--primary)`); never copy a value into a rule. The files here are
  for other tools.

## Adding a component

1. Build it from the tokens above. If it needs a value that is not there, add a token to `01-tokens.css` (and its
   dark values) rather than a value to the rule.
2. Put its rules in the part they belong to, or in a new part with the next number, added to `index.css`
   (`stylesheet.test.ts` checks that the list and the files agree).
3. If it puts text on a new colour, add the pair to the list in `web/scripts/tokens.check.mjs`.
4. If it should appear in [`component-tokens.md`](component-tokens.md), add it to the list in
   `web/scripts/tokens.export.mjs`.
5. Run `npm run tokens:export`, then `npm run check:styles`, and look at it in both themes, by keyboard, and at a
   narrow width.
