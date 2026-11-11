# 30. What changed on 12 October 2026

[setup.md](../../setup.md) · previous: [§29](29-hcmls-six-optimisation-goals-indexed.md) · next: [§31](31-what-changed-on-13-october-2026.md)

*The "numbers 5 to 19" round of [`tracker.md`](../../tracker.md): SC-17, SC-21, IN-19, IN-04, BK-04, SC-14,
IN-25, BK-11, IN-22, IN-23, IN-01, FR-16 and the template note of IN-06. Each is built and tested in both
copies. Both portals were rebuilt from this code on the afternoon of 12 October and are running it (the steps
and what was checked are at the end of this section). What needs a secret or a decision from you was left alone, and the last subsection
lists it.*

## Session length and an epoch (SC-14; §8, §19)

A sign-in lasted 12 hours, fixed in the code, and the only way to end every session at once was a new
`JWT_SECRET`. Two settings now cover both. `docker-compose.yml` passes them with the defaults below, and
`deploy/settings.example` lists them.

| Setting | Default | Effect |
|---|---|---|
| `SESSION_HOURS` | `12` | How long one sign-in lasts, a number from 2 to 24. An open portal still renews its token an hour before the end, so this limits how long a copied or forgotten session works, not how long a wall screen stays signed in. The floor is 2 because a shorter session could not be renewed in time |
| `SESSION_EPOCH` | `1` | A label of 1 to 32 letters, digits, `.`, `_` or `-`, stamped into every token as the claim `ep`. A token is refused under any other label, so raising the label and restarting the BFF ends every session without a new secret |

A value the BFF cannot use stops the start with a message that names the setting. Falling back to 12 hours
quietly would hide the mistake: someone who wrote `SESSION_HOURS=1` to shorten sessions would get twelve and
never be told. A token with no `ep` counts as epoch `1`, so a rebuild signs nobody out, and raising the epoch
later does.

To end every session, put `SESSION_EPOCH=2` in the `.env` next to `docker-compose.yml`, run
`docker compose up -d portal-bff`, and each open page reaches the sign-in form at its next request. To end one
person's access, take them out of `PORTAL_USERS` and restart the BFF: every request looks the user up again, so
that takes effect at once.

The two copies already refuse each other's tokens, because the issuer and audience come from the cookie name
(§19). A separate `JWT_SECRET` for each is still the safer setup, and it is a `.env` change that is yours to
make. Tests: `auth-sessions.test.ts` and `startup-guards.test.ts`.

## CI: pinned actions, a secret scan, Dependabot (SC-17)

`.github/workflows/docs.yml` now sets `permissions: contents: read`, and every `uses:` line names a full commit
SHA with the tag it came from in a comment after it. A tag can be moved to other code; a SHA cannot. A new job,
`secrets`, runs gitleaks over the commits of each push and pull request. It does not read the history already in
the repository, so the token in commit `cb97069` does not fail every run: revoking that token is the fix, and the
scan guards what comes next. It posts no pull request comments and uploads no findings file, because on a public
repository either would repeat what it found. Manual runs skip it, as they have no commit range. A repository
owned by an organisation needs a `GITLEAKS_LICENSE` secret.

`.github/dependabot.yml` asks for one pull request a week for the actions, for the npm packages of `server/`
and `web/` (minor and patch releases together, a major alone) and for the base image of each Dockerfile, which
the digests below would otherwise freeze. Nothing is merged for you.

`ci-workflow.test.ts` fails on a `uses:` line pinned any other way, on a job that asks for more than read
access, and on a Dependabot file that leaves an ecosystem out. The workflow has never run on GitHub, so the three
SHAs, the gitleaks job and the Dependabot file are untested until the first push.

## Base images pinned by digest (SC-21; §23)

Both Dockerfiles name each base image by tag and by digest: `node:24.11-alpine@sha256:6823...` (twice in
`server/Dockerfile`, once in `web/Dockerfile`) and `nginxinc/nginx-unprivileged:1.28-alpine@sha256:7377...`
(`web/Dockerfile`; on 11 November 2026 the web image moved to the `1.30-alpine` line, which still gets images, and both Node digests were taken again, IN-66). Docker builds from the digest, so a rebuild cannot move to other bytes unannounced. The tag
stays for people to read.

To raise one on purpose, ask the registry what the tag points at today, then change the tag and the digest
together on every line that names that image:

```sh
docker buildx imagetools inspect node:24.11-alpine --format '{{.Manifest.Digest}}'
```

The Node tag has to match in the two Dockerfiles. `container-hardening.test.ts` fails on a base image with no
digest, and Dependabot proposes the new pair each week. Both portals were built on these digests on 12 October
(see the last subsections).

## Reaching Zabbix on a Linux server (IN-25; §11)

On Docker Desktop the portals reach Zabbix as `host.docker.internal:8080`, which is the Mac. On a Linux server
that name is the Docker bridge, where a Zabbix published only on `127.0.0.1` does not answer, and the
`extra_hosts` line both compose files carry does not change that. `docker-compose.zabbix-network.yml` is an
optional second compose file that joins the BFF to the Zabbix project's own network and addresses Zabbix by its
service name:

```sh
docker compose -f docker-compose.yml -f docker-compose.zabbix-network.yml up -d
```

It costs reach. The BFF can then also see the `mysql` and `zabbix-server` containers on that network. The
database still wants a password the BFF never holds, but that is more than the single API port the default gives
it, so use the file where the default cannot work. The Zabbix stack has to be running first, because its network
must already exist. The file expects that network to be called `proto1_default` (`ZABBIX_NETWORK` changes it) and
reaches `http://zabbix-web:8080/api_jsonrpc.php` (`ZBX_NETWORK_URL` changes it).

It sets `ZBX_URL` through its own variable because a running portal's `.env` already sets `ZBX_URL`, and a default
written inside the file would have lost to it. Merging the two files with `docker compose config` showed that;
reading them did not. `compose-zabbix-network.test.ts` reads the file. Nothing here has run on Linux, so it is
untested where it matters.

## Typefaces served from this site (IN-22; §6)

Every page load used to fetch Inter and IBM Plex Mono from Google: a third party contacted on each visit to a
confidential portal, which contradicts the local-model copy's promise that nothing leaves the machine. Both
faces are now files in `web/public/fonts`: Inter as a variable font (weights 400 to 700) and IBM Plex Mono in 400,
500 and 600, each in the `latin` and `latin-ext` subsets, 8 files and 191 KB in all. They are the files Google
served for the old stylesheet, fetched on 12 October over HTTPS with the WOFF2 signature checked, so the
typefaces look the same. Both SIL Open Font Licences sit beside them, with a README that says where each file
came from.

`src/styles.css` declares them with `@font-face` and `font-display: swap`. `index.html` preloads the main face
and no longer links to Google, the CSP in `web/nginx.conf` names no host but the site's own, and nginx serves
`/fonts/` for 30 days. Text in Cyrillic, Greek or Vietnamese falls back to the system font. To change a face,
replace the file under the same name and update its `@font-face` rule if the weights changed; the 30-day cache
means a replaced file reaches browsers within a month.

Checked in headless Chrome against the built app: Inter loaded and its text widened with the weight from 400 to
700, so the file really is variable; the three Plex weights loaded; and the page asked for no host but its own.
`self-hosted-fonts.test.ts` and `nginx-conf.test.ts` keep it that way.

## The build in the sidebar footer (IN-01)

Once someone is signed in, the sidebar footer shows a line such as `Build abc1234, 07/10/2026, 16.19.57 WIB`,
read from the `build` field of `/api/health`, which only a signed-in caller receives. It appears under the
footer text, in the report's time zone like every other time in the portal, and it is absent in the collapsed
rail and for a build that was never stamped. The commit reads `uncommitted` until the repository has a commit,
which waits on SC-06. `buildLabel.test.ts` and `Sidebar.test.tsx` cover it.

## Outages that began before the look-back (BK-04; §18, §21)

The "all problems" availability basis and the Alert noise report read the PROBLEM events of the window and of
the 31 days before it, plus every problem still open now, whatever its age. That missed an outage that began
more than 31 days before the window and ended inside it. They now find it from the other end. The window's
recovery events are read, and for each trigger whose first recovery no known problem explains, the trigger's last
problem before the look-back is asked for and kept when it names that recovery.

Zabbix gives a recovery event severity 0 whatever the trigger's priority, so a severity floor on that read
returns nothing at all. The first version did that, and only the real Zabbix showed it. The floor is applied to
the triggers afterwards, with one `trigger.get` per 2,000 ids.

At most 200 triggers are looked up (`LONG_OUTAGE_LOOKUPS`). Past that, the report sets `truncated`, which now
means its figures are a floor. Still missed: a problem that began before the look-back and was resolved after the
window ended, which takes an outage longer than a month that spans the whole window.

Measured on HCML's restored data on 12 October, read-only, from inside the BFF container. September 2026 read
15,891 recoveries in 148 ms and found 11 older outages the report had missed (14 lookups, 21 ms), on top of
964 ms for the reads it already made. The widest Alert noise window, 90 days, found 15 for 531 ms on top of
1,774 ms, and August found 6 for 206 ms on top of 891 ms. `incidents-before-window.test.ts` holds a fake Zabbix
that copies this behaviour, severity-0 recoveries included.

## Five endpoints removed (BK-11; §5)

The web app never called `/api/history`, `/api/trend`, `/api/net/ports`, `/api/net/status` or `/api/net/map`.
They are gone, with the helper and the constant only they used, their tests, their OpenAPI entries and their rows
in §5. The BFF had 41 endpoints then: 35 in route modules, plus health, ready and the four sign-in routes. It has 45 now (39 in route modules), after the Devices page, the meters, the busiest hosts and web monitoring.
`/api/graph` is the one route that reads an item's history, and it keeps the operator rule for interface items
(`viewer-network-ids.test.ts`).

To bring them back, apply the patch in reverse from the folder of either copy, checking first:

```sh
patch -p1 -R --dry-run < ../documents/patches/bk-11-removed-endpoints.patch
patch -p1 -R < ../documents/patches/bk-11-removed-endpoints.patch
```

The patch covers the ten files that held code, tests and OpenAPI entries. It does not restore the prose of the
README and this file, where the endpoint count would go back to 46. Since 19 October the web also needs
`npm run gen:api` in `web/` after it, because a test fails while `web/src/generated/openapi.ts` is older than the
OpenAPI file, which has its five paths back.

## The Zabbix stack's passwords out of its compose file (IN-23)

The five password lines of `Proto1/docker-compose.yml`, the Zabbix stack outside both repos, now read
`MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD` from an untracked `.env` beside it, mode 600. The `.env` was written from
the values the file held, and nothing printed them. `docker compose config` gave the same hash before and after,
so compose sees no change and recreated nothing: the Zabbix containers ran on through it. Without the `.env`,
compose stops with a message that names the missing variable instead of starting a database with an empty
password.

To undo, copy `docker-compose/docker-compose.yml.bak` back over `docker-compose.yml` in that folder. The `.bak` holds the old
literals, so delete it when you are satisfied, together with `myown/backups/.backup-22sep/docker-compose.yml.orig` and the parked
PostgreSQL file in `docker-compose/`, which also hold literals. The passwords still reach the containers as environment variables, so
`docker inspect` shows them to anyone who can run it. The steps and the reasoning are in
`myown/documents/patches/in-23-README.md`.

## The `.env.example` templates (IN-04, IN-19, IN-06)

The two root templates now name every variable `docker-compose.yml` reads (the SLA block, the local-model tuning,
the stream caps, the AI limits, the session settings and `WEB_PORT`), each at compose's own default, and the two
`server/.env.example` files gained the ones they lacked. `env-templates.test.ts` fails when compose reads a
variable the root template does not name, when a template value differs from compose's default for a reason
nobody wrote down, and when a key is assigned twice.

It exposed two traps. The root templates said `TRUST_PROXY=false`, hidden until now by compose's default of
`true`: copying the template to `.env` would have turned the proxy handling off behind nginx. The running
containers were not affected, as they read `true`. The hosted templates also held an active `AI_TIMEOUT_MS=30000`
beside a commented `120000` example, and the last assignment in a file wins. They now leave `AI_TIMEOUT_MS` unset:
empty means 30 seconds for the hosted API and 120 for a local model (`config.ts`), and the template says so.

The write-token line in all four templates now says to leave `ZABBIX_WRITE_TOKEN` empty where Zabbix has no
server process: a close is accepted there, queued, and never applied.

## Run-time checks of every data answer (FR-16)

`web/src/lib/guards.ts` checks, as it arrives, every data answer a page reads: the six of 7 October (the problem
list, each stream frame, the host overview, stats, problems by group, freshness and `/api/auth/me`) and 23 more
(hosts, host groups, items, latest data, graphs, network devices and interfaces, top triggers, maps, sites, the
inventory scorecard, link health, the availability report in all its forms, problem ageing, capacity, alert noise,
both service trees, the SLA report and the Zabbix SLA lists). A mismatch becomes the page's ordinary error
message. The explain answers, which a model writes, are not checked.

`guardsData.test.ts` checks each guard three ways (a complete answer passes, every field is checked, and what the
type requires is required) and fails when a data call in `api.ts` has no guard. All 29 saved real answers of both
portals passed on 12 October, which is also how a mistake in the first service-tree guard was found. The helpers
copied from the server (the site table, the site reading, the sort order and the month boundaries) are compared
with their originals by what they answer, in `copiedHelpers.test.ts`.

## Checked signed in, before the rebuild (SC-21)

Earlier on 12 October both running portals, still the 7 October build, were signed in to through nginx, and each passed
all seven checks. The sign-in set an httpOnly cookie, and `/api/health` and `/api/ready` answered, with the build
the image was stamped with. A report PDF (69,966 bytes, 11 pages) and a workbook (21,925 bytes, 7 sheets) came
through the buffered `/bff/api/sli/export` path, each with a `Content-Length` equal to the bytes received. The
live stream stayed connected for 80 seconds with 4 pings and one `problems` frame (3,452 bytes), and the problems
list answered (456,644 bytes). The BFF logs held no warning. The script took the credentials from its environment
and never prints or writes them.

## Putting it live (done on 12 October)

Both portals were rebuilt from this code on the afternoon of 12 October, at your word, hosted first (09:16 UTC) and
then ollama (09:17), the way §23 says:
`BUILD_COMMIT=uncommitted BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) docker compose up -d --build`. The previous
images are tagged `<name>:rollback-7oct`, for example `hcml-portal-portal-bff:rollback-7oct`. To go back, point
`latest` at one and recreate without building (`docker tag <name>:rollback-7oct <name>:latest`, then
`docker compose up -d --no-build`). That has not been tried. These images were built for this compose file, so both
the BFF and the web container should return through compose, which the 2 October web image could not.

Checked without signing in: all four containers `healthy` with no restart; the BFFs run as `node` and the web
containers as uid 101, each with a read-only root, `ALL` capabilities dropped and `no-new-privileges`; each BFF
carries its build stamp (`BUILD_TIME` 2026-10-12T09:16:20Z hosted, 2026-10-12T09:17:47Z ollama); both pages serve the
new bundle `index-kqH0_rY-.js`; `/fonts/inter-latin.woff2` comes back 200 as `font/woff2` with
`Cache-Control: public, max-age=2592000`; the CSP header names no host but the site's own; `/api/health` answers
through nginx and `/api/problems` is refused with 401 until someone signs in; the web logs hold no
`permission denied` and the BFFs no warning.

The two checks that needed a restart were made on both portals. Recreating only the BFF
(`docker compose up -d --force-recreate --no-deps portal-bff`) gave it the same address back, which proves nothing,
so a second run stopped the BFF, let a throwaway container hold its address, and started it again at a different
one. nginx answered 200 again 0.36 s after the start on both portals, and the web container was never touched.
Stopping each container the way Docker does: the BFF ended with exit code 0 in 0.1 s, its log reading
"SIGTERM received: closing the BFF" and "BFF closed", and nginx ended with exit code 0 in 0.3 s. Each was healthy
again about 5 s after `docker start`.

Not checked, because it needs a sign-in on this build: the footer line (it should read
`Build uncommitted, 12/10/2026, 16.16.20 WIB` on :8081 and `16.17.47 WIB` on :8082), a report download through the
nginx buffer, the live stream and the Problems page. Nobody should have been signed out, because a token with no
`ep` claim counts as epoch `1`; the tests show that, and the running build has not been asked. Every open tab needs a
reload to get the new page. The Zabbix stack was not part of this rebuild.

## Left alone, and why

* SC-04 and the separate `JWT_SECRET` per copy (SC-14). Both are values in `.env` files, which stay unopened.
  The templates say what to set.
* SC-20, `NET_GROUP_IDS`. It names the host groups that hold network gear, which only you can say, and
  setting it also narrows the operator's Network page to those groups. `GET /api/hostgroups` lists them with their
  ids. It is empty in both running portals, so the map cut does nothing yet.
* IN-06, the write token. Both running portals have one set, so Acknowledge and Close are offered while no
  `zabbix-server` runs, and a close would never take effect. Whether to remove the token from these frozen-data
  deployments is your call; an empty `ZABBIX_WRITE_TOKEN` turns write-back off.
* SC-01 and SC-06. Rotating the Anthropic key, making the GitHub repository private and revoking the token in
  `cb97069` are yours. The repository was public when last checked.
