# 36. What changed on 16 October 2026, the folders

[setup.md](../../setup.md) · previous: [§35](35-what-changed-on-15-october-2026-the-audit-and-the-hosts-view.md) · next: [§37](37-what-changed-on-19-october-2026-the-check-and-six-rows.md)

*You asked whether the folders of both portals meet production practice and the rules of software construction, and then said to do points 2 to 5 of my review ("tolong lakukan kecuali nomor 1, karena aku masih ingin membuatnya terpisah"), and afterwards the grouping of the 25 flat server files that I had left out. Nothing the portal does changed: the 45 endpoints, the API contract and every earlier test are as they were. The rows are ST-01 to ST-05 of [`tracker.md`](../../tracker.md), the decision and its costs are [ADR-0013](../architecture/adr/0013-layers-features-and-tools.md), and all of it is in both copies. It was not in the running portals on 16 October and is not yet.*

## The server: routes call services (ST-01)

Each of the 22 files of `server/src/routes/` held the HTTP side of an endpoint and everything the endpoint knew, 4,728 lines in all, and a route imported another route to reuse a function. The logic now lives in `server/src/services/<area>.ts`, and a route is a registrar: it names the paths, checks the query or the body, calls one function of its service and sends the answer or the status. `routes/` is 685 lines. `services/` held 5,639 and holds more now that the big files were split (§5 lists it).

Two moves were not a plain split. The old root `chat.ts` became `services/assistant.ts` and stayed apart from `services/chat.ts`, so that a test can replace the assistant without replacing the route's helpers. The old root `meters.ts` was merged into `services/meters.ts`. State that a route used to assign at module level (the warm-up clock, the last prompt the model read, the logger) became functions of the service (`claimWarmSlot()`, `noteModelRead()`, `useLogger()`), because a service cannot be assigned to from outside.

`server/src/__tests__/layering.test.ts` fails when a file other than `index.ts` imports a route, when a service imports a route, or when a route exports more than its registrar.

## The 25 flat files, in five folders (ST-05)

26 files sat in one flat list at the top of `server/src/`, `index.ts` and 25 others, and nothing said what kind of file each was. They are in five folders by what they are for, and `index.ts` is the only file left at the top:

| Folder | What is in it |
|---|---|
| `core/` | configuration and startup checks, the TTL cache and its stale marker, the gate, query parsing, the body schemas |
| `clients/` | the Zabbix client, the model client, the caps on its use |
| `domain/` | what a host, a site and a problem are: naming rules, reachability, the shared reads |
| `security/` | sign-in and roles, passwords, the page table, the viewer policy |
| `http/` | the hooks `index.ts` wires in: rate limit, request id, compression, error mapping, health, shutdown |

Only their paths changed: 385 import specifiers in 121 files, rewritten by the TypeScript compiler's API and not by hand, so that a moved function is the same text. The one other code change is the path `http/health.ts` reads `package.json` from. The layering test has the direction written down: `core/` imports nothing outside itself, the shared folders import no route and no service, and only `index.ts` imports `http/`, with two named exceptions, both to `http/errors.ts`.

## The web: a folder for each feature (ST-02)

`pages/`, `components/`, `hooks/` and `lib/` meant that one feature was spread over four folders and its tests lived apart. There are now 11 features, `assistant`, `auth`, `dashboard`, `graphs`, `hosts`, `meters`, `network`, `problems`, `reports`, `shell` and `sla`, each with its pages, components, hooks, logic and tests, and `shared/` for what two or more features use. 146 files moved, 91 sources and 55 tests. Three files differed from a neighbour only by letter case (`Markdown.tsx` and `markdown.ts`, `HostsView.tsx` and `hostsView.ts`, `Gauge.tsx` and `gauge.ts`) and could not share a folder on a case-insensitive disk, so the lower-case ones are now `parseMarkdown.ts`, `hostsFigures.ts` and `gaugeDial.ts`.

`web/src/__tests__/layering.test.ts` holds the table of which feature may import which. Adding a line to it is the decision to couple two features. The built stylesheet is byte for byte as before (the same SHA-256).

## The stylesheet and the guide in parts (ST-03)

`styles.css` of 3,250 lines is 18 numbered parts in `web/src/styles/`, imported in order by `index.css`; the order is the cascade, so a new rule goes into the part it belongs to. `setup.md` of 2,457 lines is the index of the parts of this guide, each the text of one section line for line, and only parts 11 and 19 differ between the copies. A `LICENSE` ("all rights reserved", until you choose a licence) and a `SECURITY.md` (a report through GitHub's private vulnerability reporting, which has to be switched on in the repository's settings) are in the root: SC-30 is partly done.

## The checks in one place (ST-04)

The checkers that read the repository moved to `tools/check/` and the scripts that read a running portal to `tools/live/` (they were in `myown/checks/`, outside the repository). A root `package.json` with no dependencies runs them: `npm run check`, and `npm run verify` for the typechecks, the lint, the tests, the builds and the checkers. `.github/workflows/ci.yml` replaced `docs.yml` and has five jobs: server, web, checks, secrets and images. It has not run on GitHub (IN-30), and `npm run verify` runs no install, audit, secret scan or image build, so it is not the same as CI. `links.check` fails on a line citation of a file that is gone, and skips the dated parts of this guide.

## What it cost, and what was left

The older records name the old tree and are left as written (`tracker.md`, `CHANGELOG.md`, `AUDIT_REPORT.md` and the dated parts of this guide). The CHANGELOG entry of 16 October has a table from the old paths to the new. The line citations of the living documents were moved to the new files by the text of the line, and the table of Zabbix calls in the database ERD was made again from the code; some of that did not hold, as §38 says. `myown/documents/patches/bk-11-removed-endpoints.patch` was made again for the layout. Two server tests that read the web app's sources would have skipped without a word after the move; they point at the new files now.

Left alone, by your word or on purpose: one repository for both copies (you keep them separate, so IN-13 is as it was), the two edges that run against the grain (`http/health.ts` reads the live stream count from `services/stream.ts`, and two services read one sentence from `http/errors.ts`), and the large files, which were moved and not taken apart until §38.

Checked: server 76 files and 1,663 tests, web 77 files and 1,122 tests, both typechecks, the lint, both builds, `npm run verify` in both copies. Each layering rule was broken once to see it fail.
