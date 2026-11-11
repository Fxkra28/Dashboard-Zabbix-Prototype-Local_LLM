# Design direction

The brief below is the portal owner's, given 23 September 2026. It is the source of direction.
The antislop rules (not kept in this repository) are the filter that checks work against it; this file is what the filter checks
against. The two are not interchangeable: a filter rejects slop, it does not supply taste.

Sections 1 to 6 are the owner's words. Section 7 is measurement, added by verification, and every
figure in it is reproducible from the hex values in section 3.

Em dashes in the original have been converted to periods, commas or colons, following the decision
of 22 September 2026 that portal prose carries none. No wording was otherwise changed.

---

## 1. Identity

A shift-length instrument panel that shows its work when asked. Not a device inventory browser, and
not a chatbot with a dashboard bolted on. It exists specifically because Zabbix's own UI can't be
this: site-structured, role-aware, organised by service instead of device. That's the thing to
protect visually: every screen should read as "translated Zabbix", never as "Zabbix, but shinier".

## 2. Personality

Composed, exact, plain-spoken. Should never feel like a chatbot product. The Assistant page answers
from a read-only snapshot in the same measured voice as every other page, not a friendly mascot with
exclamation points. (The portal is read-only except one write, acknowledge and close, so restraint is
functionally true of it, not just a style choice.)

## 3. Palette

Confirmed already in place: `#0067B1`, with light and dark served by one set of CSS variables. Extend
it as a ramp in both modes rather than inventing a second hue: the blue schema, not one fixed value.

| Role | Light | Dark | Use |
|---|---|---|---|
| Chrome / ink | `#0A2540` | `#0D1B2A` | Sidebar, header |
| Primary | `#0067B1` | `#3E93D6` (lightened for AA contrast on dark) | Active nav, links, primary actions |
| Mid | `#4A90C2` | `#5FA8DE` | Secondary interactive, borders, icons |
| Tint / hover | `#EAF2F8` | `#16324A` | Hover, selected rows |
| Surface | `#FFFFFF` | `#0D1B2A` | Page and card background |

> **Superseded in part, 23 September 2026.** The logo file measured `#2B5584`, and the owner chose to
> adopt it as the primary. The ramp's structure and every rule in this section still hold; only the
> chromatic values moved. Section 8 has the measurements and the replacement table. The brief is left
> as written, because it was right about the shape of the problem before the file existed.

**Note on dark mode specifically.** `#0067B1` at full saturation under-contrasts as foreground (text
or icon) on a dark surface. Fine as a background or large block, but interactive elements need the
lightened `#3E93D6` step, not the raw brand hex, to stay AA-legible.

**Severity collision.** With 18 pages and 38 endpoints worth of tabular data, blue links and blue
chrome are already everywhere. The six fixed Zabbix severity colours are the only thing allowed to be
loud. That matters most on Problems, Alert noise, Top 100 triggers, and the streaming Dashboard,
where severity is the entire point of the page.

## 4. Typography

Confirmed: Inter, already in place. Keep it.

Add a monospace face specifically for the data this portal is full of: host names, trigger names, IPs
on Links and WAN, packet-loss thresholds (2% and 10%), the 99% SLA target, timestamps. Anywhere a
number or identifier is meant to be scanned or compared row-to-row, not read as prose.

## 5. Mood dials

> **Superseded in part, 26 October 2026.** MOTION is 2 since the owner chose soft depth with animations;
> section 10 has the decision. ENERGY and RHYTHM are unchanged, and so is the reasoning about the wall below.

**ENERGY 2/5 · RHYTHM 2/5 · MOTION 1/5**, with a concrete exception for the one page that differs.

The Dashboard streams over SSE and doubles as a NOC-wall display: the rate limiter explicitly exempts
`/api/stream` so a wall poller doesn't throttle itself, and a separate cap (100 screens in all, 5 for one
signed-in user) keeps that exemption from being an open door. Motion there is signal, not decoration. A
problem appearing or clearing should be visible at a glance from across a room. The same logic covers
the Assistant's token-by-token streaming text.

Everywhere else MOTION stays close to zero. This is a tool people watch for a full shift, and
anything animated that isn't a real state change trains operators to ignore motion, which is the one
thing you can't afford in a room that exists to notice things.

## 6. Sidebar behaviour

Collapsible, not just hideable outright. Default expanded (icons and labels), toggles to a slim
icon-only rail on click, never fully vanishing, since losing all nav context on a page someone's
watching for hours is worse than the width it saves. A chevron at the sidebar's edge is the toggle.
The width transition should be quick and snappy, sitting inside the MOTION 1/5 budget as one of the
few motions that's earned: it's a direct response to a click, not ambient decoration.

Worth remembering across page loads via `localStorage` (`collapsed: true/false`). That's a small UI
preference, not portal data, so it doesn't fight the "nothing persists" line in Known gaps (that's
about audit trails and saved views, not chrome state) and it doesn't need a backend change or a state
library, consistent with the hand-rolled, no-extra-dependencies approach already in place.

Default-collapsed specifically for the Dashboard route, since that's the one page meant to run on a
NOC wall: every extra pixel goes to the live problem feed rather than nav labels nobody's clicking on
a wall display. Everywhere else, default expanded.

---

## 7. Verification, and four things the brief left open

Contrast figures are WCAG 2.1 ratios computed from the hex values above. AA is 4.5:1 for body text,
3:1 for large text and for the boundary of a user interface component (1.4.11).

### What the brief got right, confirmed by measurement

| Claim | Measured | Verdict |
|---|---|---|
| Raw `#0067B1` under-contrasts on dark | **2.96:1** on `#0D1B2A` | Correct, fails AA |
| `#3E93D6` is the legible step | **5.26:1** on `#0D1B2A` | Correct, passes AA |
| White on chrome `#0A2540` | **15.54:1** | Passes with room to spare |
| `#0067B1` on white, and on tint `#EAF2F8` | **5.87:1** and **5.19:1** | Both pass AA |
| `#5FA8DE` on `#0D1B2A` | **6.74:1** | Passes AA |

### R-1. Dark chrome and dark surface were the same colour

The table gives `#0D1B2A` for both Chrome and Surface, so the sidebar would have been invisible
against the page. Contrast between them is **1.00:1**.

This cannot be fixed by spacing the two values further apart. The WCAG formula adds `0.05` to both
luminances, and at near-black that constant dominates, so any two colours in this navy family land
between **1.05 and 1.14** however far apart they look. Chasing a luminance gap in dark mode is the
wrong tool.

Resolved the way dark interfaces actually do it, with a hairline border instead of a luminance step:

| Plane | Value | Note |
|---|---|---|
| Chrome (sidebar, header) | `#081320` | darkest, the frame |
| Surface (cards, tables) | `#0D1B2A` | the brief's value, unchanged |
| Page behind the cards | `#0A1622` | between the two |
| Border that separates them | `#44698A` | **3.01:1** on surface, clears 1.4.11 |

### R-2. The dark tint would have been nearly invisible

`#16324A` against surface `#0D1B2A` is **1.32:1**. On a 139-host table that is not a selected row,
it is a rounding error. Kept as specified for *hover*, where faint is correct, but a *selected* row
additionally carries a 3px `#3E93D6` left bar so the selection is identifiable without relying on the
fill. A link inside a tinted row uses `#5FA8DE` (**5.12:1**) rather than `#3E93D6` (**4.00:1**).

### R-3. Mid is a border and icon colour, never text

`#4A90C2` on white is **3.47:1**. That clears the 3:1 bar for a border or an icon and misses the
4.5:1 bar for text. The brief lists it under "secondary interactive", which could be read either way,
so it is constrained here to the non-text half: borders, icon strokes, chart gridlines. Secondary
*text* links use the primary.

### R-4. Severity becomes a filled chip, never coloured text

This is the mechanism that lets section 3's "only thing allowed to be loud" survive contact with
accessibility. Zabbix's six hues are unchanged; only their application changes.

| | As coloured text on white | As `#08182A` ink on a filled chip |
|---|---|---|
| 0 Not classified `#97AAB3` | 2.41 fail | **8.10 pass** |
| 1 Information `#7499FF` | 2.71 fail | **7.19 pass** |
| 2 Warning `#FFC859` | **1.54 fail** | **12.69 pass** |
| 3 Average `#FFA059` | 2.01 fail | **9.68 pass** |
| 4 High `#E97659` | 2.92 fail | **6.69 pass** |
| 5 Disaster `#E45959` | 3.58 fail | **5.00 pass** |

All six fail as text. All six pass as a chip.

The ink is `#08182A`, not the `#0A2540` chrome value this started as. Chrome measured **4.34:1** on
severity 5, and the first draft of this file excused it as large text. That was wrong: WCAG's
large-text threshold is 18.66px bold or 24px regular, and a severity chip is neither. Darkening the
ink by one step clears 4.5:1 on all six hues, with severity 5 the tightest at 5.00:1, so no chip
depends on a size exemption. `scripts/tokens.check.mjs` asserts 4.5 for all six.

### Three existing values that had to move

| Token | Was | Measured | Now | Now measures |
|---|---|---|---|---|
| Muted text | `#64748B` | 4.43:1 on page, **short of 4.5** | `#566577` | 5.55:1 |
| Focus ring | `#3B8FCB` | 3.27:1, passing by 0.27 | `#0067B1` | 5.47:1 |
| Border, interactive | `#E2E8F0` | 1.23:1, **fails 1.4.11** | see note | 3:1 or better |

`#E2E8F0` stays for decorative rules and table dividers, where no component identity depends on it.
Input, select and button boundaries move to a stronger step that clears 3:1.

### A correction that went the other way

Section 3's "38 endpoints" was challenged during verification as stale, on the grounds that
`openapi.yaml` holds 41 paths. The challenge was wrong and the brief was right.

At the time, `openapi.check.ts` reported **41 endpoints (38 GET + 3 POST)**, and `README.md` stated
the same split twice: "17 route modules register onto it, 38 endpoints, plus health, login and
`/api/auth/me`". The three that made up the difference were health, login and `auth/me`, none of
which returns a row of anything. Batch 4 added a fourth, `POST /api/auth/refresh` (42 in all), which
returns no rows either. For a sentence about how much of this interface is tabular data competing with severity for
attention, 38 is the more accurate figure, so it stands.

Recorded because the useful lesson is the near miss: two numbers that disagree are not automatically
one number that is wrong, and the check that would have settled it in one step was reading the line
around the figure rather than the figure.

### One exception to "never a second hue"

Section 3 says the ramp is one hue and severity owns the loud colours. A line chart cannot obey that:
four shades of the same blue on one set of axes cannot be told apart, which defeats the point of
plotting them separately.

So `--series-1` to `--series-4` exist, and they are the only colours in the system outside the blue
ramp and Zabbix's six. All four sit outside severity's warm range, so a plotted line is never
mistaken for an alarm, and all four clear 3:1 against the surface in both themes because a plotted
line is a graphical object under WCAG 1.4.11.

| | Light | Dark |
|---|---|---|
| `--series-1` | `#0067B1` | `#58A6E0` |
| `--series-2` | `#0F766E` | `#4BB8A8` |
| `--series-3` | `#6D4AA8` | `#A98AE0` |
| `--series-4` | `#4A5D75` | `#93A8BF` |

The purple these replaced, `#7C4DFF`, was also used as a KPI card stripe on the Dashboard alongside
three other colours. A stripe that varies for variety is decoration, so those four came off. The
same stripe stays wherever it carries state: Capacity, Availability, Inventory and Alert noise all
set it from a threshold.

### The monospace face

Section 4 offered JetBrains Mono or IBM Plex Mono. **IBM Plex Mono** is used, for three reasons:
it ships a slashed zero, which matters on a page full of IPs and host IDs; its tabular figures align
in the SLA and packet-loss columns that exist to be compared down a row; and JetBrains Mono sits on
the short list of faces an AI reaches for by default, which is the one quality this portal's
typography should not have. It first came from the same Google Fonts request that served Inter. Since
12 October 2026 both faces are files in `web/public/fonts`, so it still adds no package to either lockfile.


---

## 8. The logo, and what measuring it changed

Added 23 September 2026, after the owner supplied `HCML.jpeg`.

### What the file turned out to be

| | |
|---|---|
| Actual format | **WebP**, despite the `.jpeg` extension. nginx serves by extension, so it would have gone out as `image/jpeg` carrying WebP bytes |
| Canvas | 1080 x 1080, fully transparent background |
| Ink | 758 x 433, so **71.9% of the canvas was empty** |
| Ink colour | **`#2B5584`** |
| Distinct colours | 970, in a two-colour logo: lossy WebP ringing around the letterforms |

Kept as `web/brand/HCML-original.webp`, which is outside `public/` and therefore not served.

### The palette moved to the logo

`#0067B1` was recorded as HCML's blue but nothing measured it against the actual artwork. The two are
**64.8 apart in RGB**, which is the worst possible distance: near enough to read as a mistake, far
enough that nobody could call them the same. The logo is the real brand artifact, so it won.

It is also simply better. `#2B5584` is **7.68:1** on white where `#0067B1` was 5.87:1.

Only the chromatic tokens moved. Chrome, the dark planes and the borders were already hue ~210,
which is the logo's own hue; `#0067B1` at hue 203 and full saturation was the one thing out of family.

| Token | Light was | Light now | Dark was | Dark now |
|---|---|---|---|---|
| `--primary` | `#0067B1` | **`#2B5584`** | `#3E93D6` | **`#6D9BCF`** |
| `--primary-strong` | `#004A80` | `#1E3B5C` | `#5FA8DE` | `#84ABD7` |
| `--mid` | `#4A90C2` | `#4681C3` | `#5FA8DE` | `#84ABD7` |
| `--tint` | `#EAF2F8` | `#E8EFF7` | `#16324A` | `#19324D` |
| `--tint-line` | `#CFE3F5` | `#C1D5EB` | `#2A4A66` | `#23456C` |
| `--focus` | `#0067B1` | `#2B5584` | `#5FA8DE` | `#84ABD7` |
| `--series-1` | `#0067B1` | `#2B5584` | `#58A6E0` | `#6D9BCF` |

The dark `--primary` step is set by one constraint: a link inside a selected row is `--primary` on
`--tint`, and that pair needs 4.5:1. `#6D9BCF` on `#19324D` is **4.51:1**, chosen from a grid so the
selected row keeps the most visible tint that still clears it.

### The plate is a measurement, not a preference

R-4 in section 7 guessed that the logo would need a white plate in the sidebar. The file settles it:

| `#2B5584` against | Ratio | |
|---|---|---|
| white | 7.68:1 | passes |
| `--bg` | 7.15:1 | passes |
| `--chrome` light `#0A2540` | **2.02:1** | fails |
| `--surface` dark | **2.27:1** | fails |
| `--chrome` dark | **2.43:1** | fails |

So the plate is the only thing that makes the logo readable in the chrome at all, in either theme.
`--logo-plate` is a fixed white rather than a surface token, because the artwork is drawn for white
and stays that way whatever the page does.

### Two crops, because a stacked lockup does not shrink

The three bands are 200px, 103px and 76px tall. Rendered, that gives:

| Slot | HCML at | "Madura Limited" at |
|---|---|---|
| Sidebar expanded, 216px plate | 47px | 18px |
| Login card, 208px plate | 45px | 17px |
| Rail, 44px plate | 11px | **4px** |
| Favicon, 16px | 8.4px | **3.2px** |

| Asset | Size | Used by |
|---|---|---|
| `logo.png` | 810 x 485 | Sidebar expanded, login card |
| `logo-mark.png` | 782 x 224 | Nothing since 25 September: the rail took the square icon (section 9, UX-22). Kept in `web/public` |
| `logo-icon.png` | 201 x 201 | Favicon, touch icon, the collapsed rail and the wall-mode header: the H glyph, flattened onto white |

All three are crops of the supplied file. Nothing is redrawn and nothing is recoloured. The favicon
is the real "H" from the wordmark rather than a monogram set in Inter, because at 16px no wordmark
is legible and a letter from the actual artwork is closer to the brand than type that is not.
It is flattened onto white on purpose: a transparent favicon disappears into dark browser chrome.

### Known, not fixed

`logo.png` is 127 KB, which is heavy for a two-colour logo. The cause is the lossy WebP source: 970
colours where there should be one. Flattening every pixel to `#2B5584` and letting the alpha channel
carry the anti-aliasing would remove the ringing and take it under 10 KB, but it rewrites pixels in a
trademark, so it is not done without a decision. A vector original would make the question moot.

> **Since 26 October 2026** the expanded sidebar shows a white version of the logo with no plate, at the
> owner's choice (section 10). The plate stays wherever the original file is shown: the sign-in card, the
> rail and the favicon.


## 9. Batch 4 decisions, 25 September 2026

The owner's answers to the design questions left open by the inspection (`tracker.md`, UX items). They are
direction, recorded as given; how each is built is checked against sections 1 to 8.

| Item | Decision |
|---|---|
| UX-12, the Dashboard's live list | Worst first: severity, then newest. The panel says "12 of N" and links to the full Problems list |
| UX-15, the wall screen | A wall mode with all four parts: a fullscreen toggle that hides the chrome and enlarges the Dashboard; a short highlight on problems that appear or clear, off under reduced motion; a live clock and a large "data as of" stamp; and no sign-in timeout. It also turns by itself between the Overview, the Hosts and, for operators and admins, the internet meters (30 seconds each, a Pause button, or a view named in the address, stops it), and the whole wall is drawn at the scale that fits the screen, smaller or larger than 1080p, as nobody scrolls a wall |
| Wall sign-in | Any open portal renews its own sign-in before it expires, for every user. Accepted trade-off: an unattended, open portal also stays signed in |
| UX-14, narrow screens | Not needed. The portal is used on desktops and the wall; section 6 stands as written |
| UX-24, the sidebar | Keep the current groups. Each menu label matches the title of the page it opens |
| UX-22, the collapsed rail | The square HCML icon (`logo-icon.png`), not the wide mark. The wide logo stays in the expanded sidebar |
| UX-23, dashes in UI text | Replace em dashes in sentences with a colon, period or comma, by what each does. Keep the "—" placeholder that means "no value", with hidden "No data" text for screen readers |


## 10. Soft depth, motion and a white logo, 26 October 2026

The owner's direction of 26 October 2026, given as answers to questions. The quotes are their words as typed.
The dial line and the colour values are proposal and verification, written at the owner's word "please follow
your propose for now", and are marked as such.

### In the owner's words

- The proposal: "i have proposal to adjust to neumorphism + darkmode + animations for modernize the website"
- Why: "My Preferences, and hope from the mentor to modernize the ui ux"
- The direction, chosen from three: "A, but keep the dark theme, and add annimations also." Then: "and also keep the color theme"
- The logo: "could u fix the logo in the sidebar, its not blend with the layout websites and dont look aesthetic"
- For the real portal: "A with edges for the real portal", "logo 1", "please follow your propose for now"

### Decisions, and the rules they were checked against

Each line is the owner's answer where the direction met a named rule (antislop R-37), recorded as given.

| Item | Decision |
|---|---|
| A shadow on every surface (antislop R-12) | "Keep: full A". Every card, tile and button is raised: the owner's override |
| Animation (antislop R-19, and MOTION 1/5 in section 5) | "Keep all of it". MOTION is 2 from here |
| The edges of controls (WCAG 1.4.11, section 7) | "Add the 3:1 edges". Controls keep a 1px edge at 3:1; cards and panels have none |
| The sidebar logo (antislop R-23) | "Option 1: white logo": the logo in white on the navy, with no plate. It recolours a trademark; HCML accepted it on 26 October ("they accept it") |
| The colour theme | Kept: the navy chrome, the blue ramp, the six severity colours and the chart colours |
| Dark mode | Kept, with the light, dark and system picker |

Dial: ENERGY 2 / RHYTHM 1 / MOTION 2 (proposal, at the owner's word). On section 5's own scale, ENERGY and RHYTHM
stay at 2/5 and MOTION moves from 1/5 to about 3/5.

### What it is

- **One plane.** The page and its cards share one soft surface, `#E3E9F1` in light and `#14263A` in dark, and depth
  separates them. What stands above the page is raised, lit from the top left; a field, the track of a segmented
  control and a chosen option are pressed in. The navy chrome keeps its colour and gets the same depth in its own
  shades. The tokens are in `01-tokens.css`, the rules in `18-soft-depth.css`.
- **Edges.** A control keeps a 1px edge in `--border-strong`, `#748496` (3.14:1) and `#517492` (3.12:1). Measured
  from the rendered pixels, a shadow alone gave 1.20 to 1.59:1.
- **Motion.** A page's content rises in once (340 ms, 50 ms between the first blocks); a Dashboard view fades in when
  its tab is chosen (240 ms); a control lifts under the pointer and presses in when used; a theme switch fades the
  colours. Only position, opacity, colour and shadow move, nothing loops, and reduced motion stops all of it. The
  wall keeps only its highlight of a problem that appears or clears.
- **Reports.** The PDF and Excel files of the SLA report keep white paper, light rows and solid lines: paper cannot
  show depth, and an Excel cell cannot take a translucent line. Their ink follows the tokens, the two darker
  status colours included (proposal, at the owner's word).
- **Logo.** `logo-white.png` (504 x 289) is made from the transparency of `logo.png`, so the letterforms are the
  supplied ones and only the colour changed: 15.54:1 on the light chrome and 18.68:1 on the dark one. The sign-in
  card keeps `logo.png` on its plate, and the rail keeps the H icon.

### Verification

| Pair | Before, on the white card | Now, on the soft plane | Needs |
|---|---|---|---|
| Body text | 15.17 | 12.42 | 4.5 |
| Muted text | 5.96 | 4.88 | 4.5 |
| Muted text on a selected row | 5.14 | 4.55 | 4.5 |
| Green status text | 5.38 | 4.90 (hover plane 4.58, selected row 4.57) | 4.5 |
| Amber status text | not listed | 4.90 (hover plane 4.59, selected row 4.57) | 4.5 |
| Red status text | 5.43 | 4.93 (hover plane 4.61, selected row 4.60) | 4.5 |
| The edge of a control | 3.31 | 3.14 (dark 3.12) | 3.0 |

Three colours moved to keep 4.5:1 on the soft plane: `--tint` to `#D8E2EE` (the preview's `#D3DEEB` gave muted
text 4.38), `--good-text` to `#217548` (4.41 before) and `--danger-text` to `#BA372E` (4.45 before).
On 11 November 2026 the three status texts went one step darker again (`--good-text` `#207146`, `--warn-text`
`#875A17`, `--danger-text` `#B4352D`), because on the hover and selected planes of a table row they measured 4.33
to 4.44:1 (UX-39). `tokens.check.mjs` derives every pair in both themes from the token values, those planes and
the muted text on the chip of each verdict included.

### What it supersedes

- Section 5: MOTION 1/5 becomes MOTION 2. The reasoning about the wall stands, and nothing rises or lifts there.
- Section 7, R-1: the page and its cards are one plane separated by depth instead of a border; controls still carry
  the 3:1 edge.
- Section 8: the plate stays for the original file; the expanded sidebar shows the white version.

## 11. The design system's gaps, fixed, 26 October 2026

A design system audit of the same day (kept outside the repository, beside the reference palette) listed twelve
gaps. The owner's answer: "Audit: which audit numbers to fix. all of it". Where a fix needed a choice the audit
left open, the choice below is a proposal made at that word, and each is undone by changing one token or one rule.
Both copies were backed up first, outside the repositories, in `myown/backups/ui-backup-26oct-2/`.

### What changed

| Gap | The fix |
|---|---|
| 1. A blue stripe on every KPI card | The stripe shows only where a state sets it: on today's Dashboard 3 of the 9 cards (High / Disaster, Warnings, Unacknowledged) |
| 2. No z-index scale | `--z-raise`, `--z-head`, `--z-corner` (inside their own box), `--z-topbar`, `--z-sidebar`, `--z-overlay`, `--z-skip`, with the old numbers, so nothing changes order |
| 3. Spacing off the scale | The 4 px grid gains half steps of 2, 6 and 10 px (the commonest values between steps) and 48 px. Every other value moved to the nearest step, and a tie went to the smaller one, since the portal is dense: panels and KPI cards 2 px less padding top and bottom (18 to 16), table rows 2 px shorter, badges and pills 2 px shorter, menu items 2 px shorter |
| 4. Targets under 44 px | Where the pointer is coarse (a tablet or a phone), every control is at least 44 px (`19-touch.css`). Desktops and the wall keep their density, so UX-14 stands |
| 5. One size of control | Two heights: 28 px (`sm` buttons, the theme picker, segmented options, the rail toggle) and 36 px (buttons, fields, the Dashboard and SLA page tabs). Measured before: 26 to 29 and 32 to 39 px |
| 6. Weights by number | `--w-regular` to `--w-bold` (400 to 700). The one 800, the Inventory score, became 700, which it already drew as: Inter is served from 400 to 700 |
| 7. Line heights by number | `--lh-solid` (1), `--lh-tight` (1.2), `--lh-body` (1.5), `--lh-loose` (1.6): 1.55 became 1.5, 1.1 became 1, 1.8 became 1.6, and the 24 px ones are `--target-min` |
| 8. Durations by number | The older transitions moved onto `--dur-1` to `--dur-4`; the spinner, the streaming cursor and the wall's highlight have their own (`--dur-spin`, `--dur-blink`, `--dur-highlight`), the last held by a test to the 10 s the code keeps a problem marked |
| 9. Breakpoints by number | `--bp-sm` to `--bp-xl` (640, 720, 900, 1100 px). A media query writes max-width 0.02 px under one, which closed a gap at 1100 to 1101 px; `NARROW_QUERY` is held to `--bp-md` by a test |
| 10. No disabled look for fields | One look for every control: dimmed to 0.5, the default pointer, no lift or press. A disabled checkbox keeps its words in `--muted` (4.88:1, dark 6.33:1), because one of them says why |
| 11. Tracking by hand | `--track-caps` (0.05em) on every uppercase label: 0.55 to 0.6 px at their sizes, where they ranged from 0.3 to 0.6 px |
| 12. No destructive button | `.btn.danger`, filled with the danger ink (`--on-primary` on it 5.72:1, dark 9.22:1). Confirm in the Acknowledge dialog takes it while Close problem is ticked, since a close cannot be taken back from the portal |

`tokens.check.mjs` now fails a value between steps on every one of these scales, in the stylesheet and in inline
styles, a raw z-index, and a media query off the breakpoints; `npm run tokens:export` writes the new families into
the handoff files. Four filters that sat 38 px tall beside the fields (Devices, Hosts, Sites, Links) took a class
and match the fields' 36 px.

### Verification

| Check | Result |
|---|---|
| Keyboard, on the Dashboard, Problems and Devices | 120 stops in each theme, none without a ring |
| A touch tablet (1024 x 768, coarse pointer), six pages | no control under 44 px; the links inside text and tables, which WCAG 2.5.8 exempts, keep their size |
| Reflow, 12 widths from 1440 to 390 px (720 px is 200% zoom), six pages | 72 of 72 with no sideways scroll |
| The click-through of section 10, both themes | 24 of 24 |
| Reduced motion | every animation and transition 0.01 ms |
| The rendered views against the build before, both themes | 1.8 to 14.0% of pixels changed per view, from rows and paddings 2 to 4 px tighter; nothing overlaps or clips |
