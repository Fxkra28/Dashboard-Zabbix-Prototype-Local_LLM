# 6. Frontend: structure

[setup.md](../../setup.md) · previous: [§5](05-backend-file-by-file.md) · next: [§7](07-live-updates.md)

Location: [`web/src/`](../../web/src/). Stack: React + TS + Vite, ECharts, React Router. HCML theme is
plain CSS (primary `#2B5584`, Inter and IBM Plex Mono, one set of CSS variables for light and dark; see
[`DESIGN.md`](../../DESIGN.md)).

The tree of `web/src/`, what each folder and file holds, the sidebar and how a page fetches its data are described in the
handover handbook, which is written from the code and checked against it: [Web: the shell and the shared
parts](../handover/2-code/web-shell-and-shared.md), [Web: the features](../handover/2-code/web-features.md),
[Web: api, types and guards](../handover/2-code/web-api-types-guards.md), [Web: styles](../handover/2-code/web-styles.md) and
[every web file with its purpose](../handover/2-code/files-web.md). Where a thing is changed is in
[Where to change X](../handover/1-folders/where-to-change-x.md). This part keeps the rules that decide what may import what.

A test sits beside the file it tests (`Sidebar.tsx`, `Sidebar.test.tsx`).

`api/`, `types/` and `guards/` are folders of one file per feature, and each has an `index.ts` that re-exports its public names, so a page still
writes `import { api } from '../../api'` and `import type { Host } from '../../types'`. A test mocks `'../../api'` and still replaces the one module
the page imports. They stayed at the root, not inside the features, because the root may import no feature and a page of any feature may call any of them.

The direction is one way. Files at the root (but `App.tsx` and `main.tsx`) and files in `shared/` import no
feature, and a feature imports another only where a table in
[`__tests__/layering.test.ts`](../../web/src/__tests__/layering.test.ts) says so (the dashboard may use the
hosts, meters, problems and shell, for example), so a feature can be read, changed or deleted knowing who else is touched.
Adding a line to that table is the decision to couple two features. The reasons are in
[ADR-0013](../architecture/adr/0013-layers-features-and-tools.md). The stylesheet's parts are
[`styles/`](../../web/src/styles/), in the order the cascade needs: [`index.css`](../../web/src/styles/index.css) lists them,
and a new rule goes into the part it belongs to.
