# Which component reads which tokens

Generated from `web/src/styles/` by `web/scripts/tokens.export.mjs`; do not edit, run `npm run tokens:export`. A row
counts the rules whose selector names the component, and lists every token those rules read. The values are in
[`tokens.json`](tokens.json) and [`_tokens.scss`](_tokens.scss); what each component is and does is in
[`README.md`](README.md).

| Component | Rules | Tokens it reads |
|---|---|---|
| Page | 3 | `--bg`, `--dur-2`, `--dur-3`, `--sans`, `--text` |
| Sidebar | 10 | `--chrome`, `--dur-2`, `--dur-3`, `--focus`, `--neu-lo`, `--on-chrome`, `--s-1`, `--s-1-5`, `--s-2`, `--s-3`, `--s-4`, `--s-5`, `--t-xs`, `--z-sidebar` |
| Menu item | 10 | `--chrome-active`, `--chrome-hover`, `--chrome-inset`, `--chrome-raised`, `--chrome-well`, `--dur-2`, `--dur-3`, `--on-chrome`, `--on-chrome-2`, `--r-lg`, `--r-md`, `--s-2-5`, `--s-3`, `--t-md`, `--target-touch`, `--w-medium`, `--w-semibold` |
| Logo | 10 | `--logo-ink`, `--logo-plate`, `--on-chrome`, `--r-md`, `--s-1`, `--s-2`, `--s-3`, `--s-5`, `--t-3xl`, `--t-sm`, `--track-caps`, `--w-bold` |
| Sidebar toggle | 10 | `--border`, `--control-sm`, `--dur-1`, `--dur-2`, `--dur-3`, `--e-1`, `--focus`, `--muted`, `--neu-raised-sm`, `--neu-raised-xs`, `--primary`, `--r-pill`, `--surface`, `--target-touch`, `--z-raise` |
| Top bar | 7 | `--border`, `--danger-text`, `--dur-2`, `--dur-3`, `--muted`, `--neu-lo`, `--s-2`, `--s-3`, `--s-7`, `--surface`, `--t-base`, `--t-xl`, `--w-semibold`, `--z-topbar` |
| Role chip | 3 | `--good-bg`, `--good-text`, `--neutral-bg`, `--neutral-text`, `--primary-strong`, `--r-sm`, `--s-0-5`, `--s-2`, `--t-xs`, `--tint`, `--track-caps`, `--w-bold` |
| Panel and its header | 10 | `--border`, `--dur-2`, `--dur-3`, `--muted`, `--neu-raised`, `--primary`, `--r-xl`, `--radius`, `--s-3`, `--s-4`, `--s-5`, `--shadow`, `--surface`, `--t-lg`, `--t-sm`, `--w-semibold` |
| KPI card | 9 | `--accent`, `--border`, `--dur-2`, `--dur-3`, `--lh-solid`, `--muted`, `--neu-raised`, `--r-xl`, `--radius`, `--s-1`, `--s-1-5`, `--s-3`, `--s-4`, `--s-5`, `--shadow`, `--surface`, `--t-3xl`, `--t-base`, `--t-sm`, `--w-bold`, `--w-medium` |
| Severity tile | 5 | `--border`, `--dur-2`, `--dur-3`, `--neu-raised-xs`, `--r-md`, `--s-0-5`, `--s-2`, `--s-3`, `--t-xl` |
| Device-kind tile | 10 | `--border-strong`, `--disabled-opacity`, `--dur-2`, `--dur-3`, `--muted`, `--neu-inset-sm`, `--neu-raised-xs`, `--on-primary`, `--primary`, `--r-lg`, `--r-md`, `--s-1`, `--s-3`, `--s-4`, `--surface`, `--surface-2`, `--text` |
| Hosts-view tile | 8 | `--border`, `--border-strong`, `--danger`, `--dur-2`, `--dur-3`, `--muted`, `--neu-raised-xs`, `--r-lg`, `--r-md`, `--s-1`, `--s-3`, `--s-4`, `--surface`, `--surface-2`, `--text` |
| Internet meter | 27 | `--border`, `--border-strong`, `--danger`, `--danger-text`, `--dur-2`, `--dur-3`, `--lh-tight`, `--muted`, `--neu-raised-sm`, `--r-md`, `--r-pill`, `--r-xl`, `--s-1`, `--s-10`, `--s-2`, `--s-3`, `--surface`, `--t-sm`, `--t-xl`, `--t-xs`, `--w-bold`, `--w-semibold`, `--warn`, `--warn-text` |
| Gauge | 16 | `--border`, `--border-strong`, `--danger`, `--good`, `--mid`, `--muted`, `--sans`, `--surface`, `--text`, `--warn` |
| Button | 20 | `--border-strong`, `--control-md`, `--control-sm`, `--danger-text`, `--disabled-opacity`, `--dur-2`, `--dur-3`, `--neu-inset-sm`, `--neu-raised-sm`, `--neu-raised-xs`, `--on-primary`, `--primary`, `--r-lg`, `--r-md`, `--s-1`, `--s-3`, `--s-4`, `--surface`, `--t-md`, `--t-sm`, `--target-touch`, `--w-semibold` |
| Segmented control and tabs | 13 | `--border`, `--border-strong`, `--control-sm`, `--disabled-opacity`, `--dur-2`, `--dur-3`, `--neu-inset-sm`, `--neu-raised-xs`, `--on-primary`, `--primary`, `--r-lg`, `--r-md`, `--s-1`, `--s-3`, `--surface`, `--surface-2`, `--t-base`, `--target-touch`, `--text`, `--w-semibold` |
| Form field | 4 | `--muted`, `--s-1`, `--s-3`, `--t-sm`, `--w-semibold` |
| Text field and select | 22 | `--border-strong`, `--control-md`, `--control-sm`, `--disabled-opacity`, `--dur-2`, `--dur-3`, `--focus`, `--focus-ring`, `--mid`, `--muted`, `--neu-inset`, `--r-lg`, `--r-md`, `--r-sm`, `--r-xs`, `--s-1`, `--s-2`, `--s-2-5`, `--s-3`, `--surface`, `--t-base`, `--t-md`, `--t-sm`, `--target-touch`, `--text` |
| Theme picker | 4 | `--border-strong`, `--control-sm`, `--muted`, `--r-sm`, `--s-1`, `--s-2`, `--s-3`, `--surface`, `--t-sm`, `--target-touch` |
| Data table | 21 | `--border`, `--dur-highlight`, `--muted`, `--primary`, `--s-1`, `--s-1-5`, `--s-2`, `--s-2-5`, `--s-3`, `--surface`, `--surface-2`, `--t-base`, `--t-sm`, `--target-min`, `--target-touch`, `--tint`, `--track-caps`, `--w-medium`, `--w-semibold` |
| Table scroller | 2 | `--r-md`, `--surface` |
| Severity chip | 1 | `--on-severity`, `--r-pill`, `--s-0-5`, `--s-1-5`, `--s-2-5`, `--t-sm`, `--w-semibold` |
| Status pill | 7 | `--border`, `--border-strong`, `--danger-bg`, `--danger-line`, `--danger-text`, `--good-bg`, `--good-line`, `--good-text`, `--muted`, `--primary`, `--r-pill`, `--s-0-5`, `--s-1-5`, `--s-2-5`, `--surface`, `--surface-2`, `--t-sm`, `--tint`, `--tint-line`, `--w-semibold`, `--warn-bg`, `--warn-line`, `--warn-text` |
| Tag | 7 | `--danger-bg`, `--danger-text`, `--good-text`, `--neutral-bg`, `--neutral-text`, `--primary-strong`, `--r-sm`, `--s-0-5`, `--s-2`, `--t-xs`, `--tint`, `--w-medium`, `--warn-bg`, `--warn-text` |
| Notice | 2 | `--lh-body`, `--primary`, `--r-md`, `--s-2-5`, `--s-3`, `--s-4`, `--t-sm`, `--text`, `--tint`, `--tint-line`, `--warn`, `--warn-bg`, `--warn-line` |
| Live marker | 5 | `--good`, `--good-glow`, `--muted`, `--s-1-5`, `--t-sm`, `--w-semibold`, `--warn`, `--warn-text` |
| Explain drawer | 2 | `--dur-2`, `--e-drawer`, `--ease-out`, `--surface` |
| Dialog | 5 | `--border-strong`, `--dur-2`, `--e-3`, `--ease-out`, `--focus-ring`, `--mid`, `--r-md`, `--radius`, `--s-2`, `--s-3`, `--surface`, `--t-md`, `--text` |
| Empty, loading and error message | 2 | `--danger-text`, `--muted`, `--s-10` |
| Spinner | 1 | `--border`, `--dur-spin`, `--primary` |
| Wall mode | 10 | `--s-1`, `--s-1-5`, `--s-3`, `--s-4`, `--t-xl` |
