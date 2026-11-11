# The two copies

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Operators and developers | about 5 min | [Tools, deploy and docs](tools-deploy-docs.md) | [Where to change what](where-to-change-x.md) |

The portal lives in two folders, `hcml-portal` and `hcml-portal-ollama`. They hold the same code, byte for byte, and differ in a short list of files that describe or configure the copy. This page says what differs, why, how to tell which copy you are in, and how to keep them in step.

## What differs

One thing decides it: which model writes the plain-language answers.

| | `hcml-portal` | `hcml-portal-ollama` |
|---|---|---|
| Who answers Explain and the Assistant | Hosted Claude, over the internet, through the Anthropic API | A model running on the host machine, reached through Ollama's OpenAI-compatible address |
| What leaves the machine | The text of a problem or an SLA figure, and the Assistant's snapshot of the estate, when someone asks, and the monthly report by email, when an administrator sends it and email is set up | Nothing. The fonts are served from the site in both copies, so nothing is fetched from outside either, and this copy never emails a report: its compose file passes no mail settings |
| Address | Port 8081 on the loopback address | Port 8082 on the loopback address |
| Session cookie | `hcml_session` | `hcml_session_ollama` |
| Under git | Yes. CI runs here, and the `live-<date>` tags are cut here | No. It is written by copying from the other |

Cookies ignore ports, so two portals on one machine would overwrite each other's session if they shared a cookie name. That is the reason for the second cookie name.

The settings that carry the difference are few. In `docker-compose.yml` they are the origin the browser is allowed to call from, the published port, the cookie name, and the model settings: the hosted copy takes `AI_PROVIDER` and `ANTHROPIC_API_KEY` from `.env`, and the local copy fixes the provider to an OpenAI-compatible server and points it at the host machine. With no model named, the hosted copy asks for a default Claude model and the local copy for `qwen3:8b`, both set in `server/src/core/config.ts`. Nothing in `server/src` or `web/src` asks which copy it is in; only the settings differ ([decision record 5](../../architecture/adr/0005-provider-neutral-ai-layer.md)).

## The files that differ

`tools/check/parity.check.mjs` holds the list. Each file is on it because it describes or configures one copy.

| File | Why it differs |
|---|---|
| `README.md` | Each describes its own copy: its model, its port, its tests. |
| `AUDIT_REPORT.md` | Each records the audits from its own copy's point of view. |
| `docker-compose.yml` | The origin, the port, the cookie name and the model settings, as above. |
| `docs/index.md` | The opening says which copy it is in. |
| `docs/api/openapi.yaml` | The description of the server addresses. Everything else in it is the same. |
| `docs/architecture/adr/0005-provider-neutral-ai-layer.md` | The consequences of the decision for each copy. |
| `docs/flow/README.md`, `docs/flow/DataFlow.mmd`, `docs/flow/DataFlow.pdf` | Where the data goes depends on who writes the answer. |
| `docs/schema/README.md`, `docs/schema/CDM.mmd`, `docs/schema/CDM.pdf`, `docs/schema/ERD.mmd`, `docs/schema/ERD.pdf`, `docs/schema/PDM.mmd`, `docs/schema/PDM.pdf` | The model draws the answer in red in the hosted copy, because its text leaves the machine. |
| `docs/setup/11-running-deploying.md` | How each copy is run and deployed. |
| `docs/setup/19-authentication-rbac.md` | The cookie name and the addresses in its examples. |

Four more files differ and are never opened by any tool: `.env`, `.env.example`, `server/.env` and `server/.env.example`. They hold settings, and the real ones hold secrets. One more file exists in the local-model copy only: `docs/README_copy.md`, a snapshot of its README from September, kept for reference and not maintained.

Files that are meant to be the same, such as `docs/flow/ServerFlow.mmd` beside `docs/flow/DataFlow.mmd`, are held to it. The list names each file, never a folder, so a one-sided edit to a file that should match is reported even when it sits next to one that should not.

## Which copy am I in

The folder name says it. So does the port in the address bar, the name of the session cookie in the browser's tools, and the opening lines of `README.md` and `docs/index.md`. A running portal reports its build at `/api/health` after sign-in, and the sidebar shows it in its footer. The two copies show the same commit, because the local-model copy is built from the hosted copy's commit.

## Keeping them in step

A change to shared code lands in both folders, in the same piece of work. The order that avoids mistakes:

1. Make the change in `hcml-portal`, the copy under git, and get its checks green.
2. Copy the shared files across with `rsync -a --delete`, and the exclude list that names the files above and `.env*`, `pic/`, `node_modules/`, `dist/`, `.git/`, `.DS_Store` and `*.tsbuildinfo`. Run it with `--dry-run` first and read what it would do. `--delete` removes a file from the destination that the source lacks, which is right for a deleted file and wrong for one that belongs to the destination only.
3. Edit the per-copy files by hand in each folder, if the change touches what they say.
4. Run `npm run verify` in both folders. Its last step is `parity.check`, which compares the two and fails on any difference that is not on the list.
5. Rebuild both ([the rebuild script](tools-deploy-docs.md#deploy) does it in order, the hosted copy first).

Merging the two into one repository with two profiles was considered and not done: it would change how both live portals are built and started. The price is that a fix is two edits, two builds and two deployments, and the parity check is what makes that safe.

`docker-compose.override.yml` is in both folders and is not on the list because it is the same in both. It is not in git. If the two ever need different overrides, put it on the exclude list first, or the next copy will overwrite one with the other.
