# Change recipes

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 9 min | [Deploy, rebuild and roll back](deploy-rebuild-rollback.md) | [Troubleshooting](troubleshooting.md) |

Eleven changes that come up, each as the list of places to touch and the check that fails if one is forgotten. The portal is arranged so that most checks fail loudly. A recipe is therefore short, and the tests are the proof that it is complete. Run `npm run verify` after each, in both copies, as the last step of every recipe.

## 1. Add a view that reads Zabbix

Every existing page is an instance of this pattern.

1. The service. Add a function to `server/src/services/<area>.ts` that calls `zbx('<method>', {...})`, shapes the answer, and takes plain arguments. It knows nothing of Fastify's request and reply, so a test calls it directly. Wrap what is costly in `cached` with a lifetime. Ask for a stale window (`staleReport`, or `SLOW_VIEW` for a slow view) only where an old copy is honest, and never for problem state.
2. The route. Add `server/src/routes/<area>.ts`, a registrar that names the path, checks the query with `singleValues`, `requireId` and `intParam`, and calls the service. Register it in `server/src/index.ts`, after `setupAuth`. A route imports services and never another route, and `layering.test.ts` fails if it does.
3. The contract. Add the path to `docs/api/openapi.yaml`. `npm run check:api` fails on a route that is registered and not described. If the page is in the sidebar, add it to `PAGE_API` in `server/src/security/pageAccess.ts`, so that the menu and the guard agree on who may open it. Add its row to the endpoint table of `docs/setup/05-backend-file-by-file.md`, which `facts.check` compares with the routes.
4. The types. Add the shape to the file of its feature in `web/src/types/` and export it from `types/index.ts`. Describe the same answer in the YAML, and run `npm run gen:api` in `web/`. The typecheck fails where the file promises less than the type needs.
5. The guard and the call. Add a guard to `web/src/guards/`, a method to the file of its feature in `web/src/api/`, and its path with its type to the table at the top of `web/src/__tests__/openapiTypes.test.ts`, which fails for a data call that is not in it.
6. The page. Put it in `web/src/features/<feature>/` with its test beside it. A new feature is a new folder and a line in the table of `web/src/__tests__/layering.test.ts`. Build it with `useAsync` and `Async`, and reuse what is in `shared/`.
7. Wire it: a `Route` in `App.tsx`, a link in `Sidebar.tsx`, and a line in the page list of `tools/live/page-audit.mjs` and `layout-sweep.mjs`, which `live-tools.test.ts` makes you do.

## 2. Change who may call a route

1. Edit `ROUTE_RULES` in `server/src/security/auth.ts`. A pattern and the lowest role for it. A route that matches none needs a viewer.
2. Update `surface.test.ts`, which pins every route and its role. A change to who may call what has to be made on purpose, in two places.
3. If it is a menu page, `pageRoles` follows by itself, since it runs `requiredRole` over the route that fills each page. Update the description of the route in `docs/api/openapi.yaml`, and the roles table in `docs/handover/0-everyone/who-can-do-what.md`.
4. Confirm with a signed-in account of the lower role that the page now says "This page is for ..." and the call is a 403.

## 3. Add a setting

1. Read it in `server/src/core/config.ts`, with a default, through the helpers that exist (`envNum` and the rest). If a wrong value must stop the server, check it in `assertConfig`.
2. Pass it through `docker-compose.yml`, since Compose hands a container only the variables it lists. `compose-env.test.ts` fails when the server reads a setting that Compose leaves out.
3. List it in both `.env.example` files and in `deploy/settings.example`, which is the versioned list of the non-secret settings.
4. Describe it in the Configuration section of `README.md`. `facts.check` fails when a setting the server reads is not named there.
5. If the setting is for one copy only, such as the model's address, edit the two compose files by hand. [The two copies](../1-folders/the-two-copies.md) says which files differ on purpose.

## 4. Add a user, a role or a password

Users come from the environment, in `PORTAL_USERS` as `name:password:role`. A role is `viewer`, `wall`, `operator` or `admin`.

1. To store a password as a hash and not as text, run `server/scripts/hash-password.ts`. It prints a salted hash that begins `scrypt.`, which goes in the setting in place of the password.
2. Edit the setting in the copy's `.env`, then recreate the server container (`docker compose up -d`). A user removed from the list is refused, and a changed role applies, on their next request.
3. Make a new encrypted copy of the `.env` files.
4. Sign in with the account and check what the sidebar shows. The menu follows the server's answer.

## 5. Change a threshold

The thresholds are settings: `LINK_LOSS_WARN` and `LINK_LOSS_CRIT` for the Links page, `NOISE_SHORT_SECONDS` and `NOISE_MIN_COUNT` for the noise report, `SLO_TARGET` for the SLA, `SLI_MIN_COVERAGE` for how much data a figure needs, `AVAILABILITY_MIN_SEVERITY` for the availability report. Follow recipe 4's steps 2 and 3. A threshold that changes a published figure, such as `SLO_TARGET`, changes the SLA pages and the report files for every month at once, so say so to the people who read them. To change a default for every deployment and not for one, change the number in `server/src/core/config.ts` and in `deploy/settings.example`, and the sentence that states it in the README's Configuration section.

## 6. Add a Zabbix method

1. Call it only through `zbx` for a read, or `zbxWrite` for the one write. A new write is a decision for the owner, and an ADR: [the decisions](../5-reference/decisions.md) say why there is only one.
2. Add the method to the table of Zabbix calls in `docs/erd/database/ERD-Database.md`, which `facts.check` compares with the lines of the code that name each method, and to every document that states how many methods the portal calls.
3. Ask only for the fields you need. The expensive ones are listed in [the traps](traps.md): `lastvalue` costs a query for each item, and `opdata` one for each problem.
4. Test it with `vi.mock` of `server/src/clients/zabbix.ts`, which keeps the real error classes, and with a fixture whose every field is a string.

## 7. Change what an endpoint answers

1. Change the service and its test. Change the description in `docs/api/openapi.yaml`.
2. `npm run gen:api` in `web/`, and commit `web/src/generated/openapi.ts` and `openapi.json` with it. The web tests fail while those are stale.
3. Update the type in `web/src/types/` and the guard in `web/src/guards/`. A field added to a type is a build error in the guard, so the compiler leads you to it.
4. Run the contract test, `openapi-contract.test.ts`, which checks the answers against the description.

## 8. Change the look

1. Find the part of the stylesheet the rule belongs to, and put it there. A new part takes the next number and an import in `index.css`.
2. Use tokens for every colour, space, size, weight, layer and duration. A new colour goes into `01-tokens.css` in the light block and in both dark blocks. `npm run check:styles` fails a raw value and a colour pair that is too faint.
3. If a token changed, `npm run tokens:export`, and commit the three files in `docs/design-system/`.
4. Look at the page in both themes, at a narrow width, and with the keyboard. `tools/live/page-audit.mjs` and `keyboard-walk.mjs` do the last two against a running portal.

## 9. Change a diagram

1. Edit the `.mmd` source, and render it again with the invocation in the README of its folder, to a PDF and a PNG.
2. Look at the picture, and not at the source. A diagram that parses is not one that reads well.
3. Run `node tools/check/diagrams.stamp.mjs`, which sets the source's stamp and refuses a source whose PDF is older than it. `diagrams.check` fails in CI on a source edited after its stamp.
4. The rules learned by breaking them: no empty `%%` line, no numeric HTML entity in a label, no empty subgraph frame, and no semicolon in a sequence diagram's message.

## 10. Keep the two copies equal

1. Edit shared files in `hcml-portal`. Bring `hcml-portal-ollama` equal with a dry run of the copy command first, and read what it would change. The files that differ on purpose are listed in `tools/check/parity.check.mjs` and in [the two copies](../1-folders/the-two-copies.md), and are edited by hand in both.
2. Run `npm run check:parity` from either copy. It lists every file that differs or exists in one only, outside the list.
3. Never copy `docker-compose.override.yml` or an `.env` file, and never commit them.

## 11. Update this handbook

1. After a change to code, run `npm run handover:build`. It rewrites every generated block and each page's reading time.
2. If a quoted snippet fails the check, the code under it changed after its explanation was written. Read the explanation again. If it is still true, run `node tools/handover/build.mjs --accept docs/handover/2-code/<page>.md`. If it is not, fix the words first.
3. A new code file needs a card in `files-server.md`, `files-web.md` or `files-tools.md`, with a sentence above it. A new folder of source needs a description in part 1.
4. Run `npm run check:handover`. [How the handbook is kept true](../5-reference/how-the-handbook-is-kept-true.md) explains the rules.
