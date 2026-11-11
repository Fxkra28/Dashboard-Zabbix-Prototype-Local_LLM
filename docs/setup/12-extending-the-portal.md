# 12. Extending the portal (recipe)

[setup.md](../../setup.md) · previous: [§11](11-running-deploying.md) · next: [§13](13-plain-language-layer.md)

To add a new Zabbix-backed view:

1. BFF, the service: add a function to `server/src/services/<area>.ts` that calls `zbx('<method>', {...})`,
   enriches or aggregates as needed, and takes plain arguments. It knows nothing of Fastify's request and reply, so a
   test calls it directly.
2. BFF, the route: add `server/src/routes/<area>.ts`, a registrar that names the path, checks the query with
   `validate.ts`, wraps the call in `cached()` and sends the answer. Register it in `index.ts`. A route imports
   services and never another route; `layering.test.ts` fails if it does. Add the path to
   [`docs/api/openapi.yaml`](../api/openapi.yaml): `npm run check:api` fails on a route that is registered and undocumented. A page
   of the menu also goes in `pageAccess.ts`, so that the sidebar and the guard agree on who may open it.
3. Types: add the response shape to the file of its feature in `web/src/types/` and export it from `types/index.ts`, and describe the same answer in
   `openapi.yaml` (step 2), then run `npm run gen:api` in `web/`. `npm run typecheck` fails where the file promises less than the type needs.
4. API client: add a method to the file of its feature in `web/src/api/` (`api/index.ts` spreads each file's calls into the one `api` object), and add its path with its type to the table at the top of
   `web/src/__tests__/openapiTypes.test.ts`; that test fails for a data call that is not in it.
5. Page: put it in the feature folder it belongs to, `web/src/features/<feature>/` (a new feature is a new folder
   and a line in the table of `web/src/__tests__/layering.test.ts`), with its test beside it. Build it with
   `useAsync` + `<Async>`, and reuse what is in `shared/`: `SeverityBadge`, `SeverityCounts`, `KpiCard`, the tables. A
   feature that needs another feature's code imports it only where that table allows.
6. Wire: add a `<Route>` in `App.tsx` and a link in `Sidebar.tsx`; the link's label is also the page title (`PAGE_TITLES` in `Sidebar.tsx`, read by `Layout.tsx`).

That's the whole pattern: every existing page is an instance of it.
