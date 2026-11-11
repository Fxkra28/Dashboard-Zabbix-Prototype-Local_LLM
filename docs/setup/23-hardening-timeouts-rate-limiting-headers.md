# 23. Hardening: timeouts, rate limiting, headers

[setup.md](../../setup.md) · previous: [§22](22-testing.md) · next: [§24](24-assistant.md)

Three plugins and one timeout, all in [`index.ts`](../../server/src/index.ts), registered in an order that
matters.

Timeouts. `fetch` has no default timeout. Before this, one unresponsive Zabbix held the request
open forever, and every page waiting on it was held up too. `zabbix.ts` now passes
`AbortSignal.timeout(config.zbxTimeoutMs)` and maps the abort to a typed `ZabbixTimeoutError` → 503,
alongside the existing `ZabbixAuthError`. Same reasoning as that one: *"Zabbix is not responding"*
and *"the portal is broken"* need different responses from whoever is reading the screen.

The hosted model client had the mirror-image problem: the SDK defaults to a 10-minute timeout
and two retries, which is sane for a batch job and absurd for a request a human is waiting on behind
a button. Both are now configured. The local backend re-uses `zabbix.ts`'s pattern directly
(`AbortSignal.timeout` → typed error), with a larger ceiling: a local model generates more slowly and
loads from disk when cold. It does not retry: a local model that failed once is usually down rather
than flaky.

Order of registration. helmet → cors → rate-limit → auth → routes.

Rate limiting sits *before* the auth guard so a flood is rejected before the server spends work
verifying JWTs on it, and a request the guard refuses still counts. It is a root `onRequest` hook
(`rateLimit.ts`): the plugin's own hooks go on each route and run after the guard. The endpoint that
actually needs it is `POST /api/auth/login`, which is otherwise an unthrottled password oracle, so
it also has a limit of its own, checked on top of the global one: 10 attempts a minute per account
and address (`LOGIN_ATTEMPTS_PER_MINUTE` in `auth.ts`). After 10 failed sign-ins in a row for one
account from one address, sign-in is locked for a minute, doubling with each further failure up to
5 minutes, and a success clears it (`LOGIN_LOCK_*`). The cap is short on purpose: behind Docker
every browser shares one address, so a long lock would lock the account out for everyone. Three exemptions: `/api/stream` holds
one long-lived connection per NOC screen rather than making repeated requests, and is capped
by its own count instead (`STREAM_MAX_CLIENTS`, `STREAM_MAX_PER_USER`, §7), `/api/health` is
polled deliberately by every page, and sign-out must never be refused, or the cookie would stay
working behind a page showing the sign-in form. They are matched against the route, so no spelling
of those paths is counted.

Emailing the report has an allowance of its own, on top of the global one: 5 sends an hour for each person
(`SENDS_PER_HOUR` in `security/mailLimit.ts`), counted in memory so a restart gives everyone a fresh hour. A
request is counted once it has passed its checks, so a mistyped request costs nothing, and an attempt the mail
server turned down is counted all the same, because the account was used. Past it the answer is
`429 rate_limited` with `Retry-After` in seconds.

**`trustProxy` is a prerequisite, not a detail.** Behind nginx every request carries the proxy's IP,
so without it all users share one rate-limit bucket and the limiter is worthless. But turning it on
with *nothing* in front is worse: a client can then forge `X-Forwarded-For` and rotate past the
limit. Hence `TRUST_PROXY`, off by default and set true only in `docker-compose.yml`. `true` means
one hop, the nginx in front, and a positive integer N means N hops; anything else trusts none.
Fastify 5.12 reads a bare hop count as "trust nobody", so `config.ts` hands it Fastify 4's hop rule
as a function (`trustProxyOption`) instead.
Until 24 September `true` trusted every hop, so the left-most `X-Forwarded-For` entry, which the
client writes, picked the rate-limit key. With one hop the BFF reads the right-most entry, the one
nginx appended, and ignores anything the client put in front. With a TLS proxy in front of nginx,
set `TRUST_PROXY=2` in `.env` (compose passes it through). That proxy must also keep the browser's
`Host` header (nginx `proxy_set_header Host $http_host;`, Apache `ProxyPreserveHost On`; Caddy,
Traefik and HAProxy keep it by default). The sign-in and every cookie `POST` are refused with 403
`csrf` when the browser's `Origin` does not name the `Host` the BFF receives. The BFF never reads
`X-Forwarded-Host` for that check, because a client can set it. Behind Docker's port publishing every
browser reaches nginx from the same gateway address, so the sign-in limit is keyed on the username
as well as the address.

Shutdown. `shutdown.ts` handles `SIGTERM` and `SIGINT`: it ends every live stream (`app.close()`
would otherwise wait on them until Docker kills the container), closes, and exits 0, or exits 1 after
8 s, under Docker's 10 s stop timeout. A second signal exits at once. Compose also sets `init: true`
on `portal-bff`, and the Dockerfile's `CMD` stays in exec form with no `npm start` or shell in front,
since either would swallow the signal.

One header caveat. `stream.ts` writes its SSE headers through `reply.raw.writeHead`, bypassing
Fastify's reply object. helmet's headers still arrive, since helmet 13 sets them on the raw response
at `onRequest`, but the CORS headers do not. That is harmless: the stream is same-origin.

The app's own headers come from nginx. helmet covers the BFF's replies only. `web/nginx.conf`
adds `Content-Security-Policy`, `X-Frame-Options: SAMEORIGIN`,
`X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` to the pages and files it
serves, and hides its version. The CSP is enforced since 14 October (SC-24, [section 32](32-what-changed-on-14-october-2026.md#32-what-changed-on-14-october-2026)):
a script, image or connection to another site is blocked, and `style-src` keeps `'unsafe-inline'`
because ECharts and React set inline styles. The BFF's own replies carry `Cache-Control: no-store`
(except the public health check) and no `Strict-Transport-Security`, because the portal is served over
plain HTTP: the proxy that adds TLS sends that one.


## Request ids and `/api/ready` (7 October 2026, tracker IN-09)

- One id per request. nginx makes it (`$request_id`, in `web/bff-proxy.inc`), replacing anything the client sent, and writes it in its access log as `rid=`. The BFF uses it as Fastify's request id: it is `reqId` on every BFF log line of the request, the `X-Request-Id` header of the reply (the live stream's too), and `requestId` in the body of every error. To follow a failure, ask for the `requestId` shown in the error and search both logs for it. A request that reaches the BFF some other way keeps a sent id only if it is 8 to 64 letters, digits, `.`, `_` or `-`, and gets a new one otherwise, so a caller cannot choose what is written to the log.
- `GET /api/ready` answers `503` while the portal cannot read Zabbix and `200` otherwise, with the same body either way: the check's fields (`ok`, `zabbix`, `zabbixMs`, `model`, `checkedAt`) and the version, start time, build and screen count. It is for a monitor that holds a session or Bearer token, so it is guarded like any route (viewer). `/api/health` stays public and always 200, which is what the container healthcheck reads. Both read one cached check, so polling either costs Zabbix at most one call in 15 s. The model never changes the status.
- Not built: metrics in a collector's format. Nothing here scrapes them, and `/api/ready` carries the counts a person would look at.

## Containers (7 October 2026, SC-21)

Both images run as an unprivileged user and both compose files harden the containers. The BFF runs as `USER node`. The web image is `nginxinc/nginx-unprivileged`, which cannot bind port 80, so nginx listens on 8080 inside the container; the host side of the mapping is unchanged (`127.0.0.1:8081` or `:8082`). Each service has `read_only: true` with a small `tmpfs` for `/tmp` (and, in the hosted copy, the BFF one volume, `portal-state`, mounted at `/data`, the only other place it may write, for the small file of ADR-0015) (nginx keeps its pid file and temporary files there, and a proxied report download is buffered there), `cap_drop: ALL`, `no-new-privileges`, a memory and CPU limit (the BFF 2 GiB and 2 CPUs, the web 256 MiB and 1 CPU), a swap limit equal to the memory limit (Docker's default allows twice the memory) and a limit on processes (256 for the BFF, 128 for the web: IN-71) and a healthcheck: the BFF fetches `/api/health` and reads the status, the web fetches `/` with `wget`. The base images carry an explicit minor tag and, since 12 October 2026, the digest it pointed at (`node:24.22-alpine@sha256:...`, `nginxinc/nginx-unprivileged:1.30-alpine@sha256:...`; the 1.28 line of that image stopped getting images in February 2026, so it moved to 1.30 on 11 November 2026, IN-66). The BFF image carries no npm, npx, yarn or corepack and no source maps, since nothing in a running container needs them (IN-71). Raise one on purpose, tag and digest together, on every Dockerfile line that names the image (§30 shows how to read the digest).

First run, 7 October 2026. Both portals were rebuilt that day, hosted first and then ollama. Checked from outside, with no sign-in: all four containers `healthy` with no restart; the BFFs run as `node` and the web containers as uid 101, each with a read-only root, `cap_drop: ALL` and `no-new-privileges`; the BFF is healthy before the web container starts; both pages load; `/api/health` answers through nginx, which finds the BFF by name; the web log shows requests and no `permission denied`; the BFFs log no warning. **Not checked** because it needs a sign-in: a report download (the buffered path), the live stream staying connected, and the Problems page. Sign in once after any rebuild and open the Dashboard, download one report and open Problems.

Second run, 12 October 2026. Both portals were rebuilt again, the first build on the digest-pinned base images, and the recreate and stop checks that the first run could not make were made: see §30, "Putting it live".

Steps for a rebuild. Save the current image IDs first, for a rollback (`docker tag <id> <name>:rollback-2oct`); build with `BUILD_COMMIT` and `BUILD_TIME` set; then check that both containers are `healthy`, that the page loads on :8081 and :8082, that a report downloads (the buffered path), that the live stream stays connected, and that the web container's log shows requests and no `permission denied`. Every open tab needs a reload and a new sign-in.

The script. Since 22 October 2026 `deploy/rebuild.sh` makes these steps (tracker IN-01); run it from `hcml-portal`, with `--dry-run` first. It refuses a tree whose `server/`, `web/` (their tests apart, which no image holds) or compose file differ from the commit, so that a build named by a commit is what that commit holds (`--allow-dirty` builds anyway and labels it `-dirty`); it runs the parity check and `npm run verify`; it checks that Docker can read each copy's `.env` (tracker IN-38), naming only the line it cannot, since Docker's own message can quote a secret; it tags the images it replaces `rollback-<day><month>` (`rollback-22oct`, then `rollback-22oct-2` for a second build that day); it builds hosted and then local-model with `BUILD_COMMIT` and `BUILD_TIME`; it waits for the containers to be healthy; and it asks what an anonymous caller sees: the health route answers, the meters are refused with 401, `/.env` and `/.git/config` give 404, the page carries a Content-Security-Policy, and it prints the bundle name and the build label. On a clean tree it then makes the annotated tag `live-<date>` in `hcml-portal`. It never pushes the tag, and what needs a sign-in (a report download, the stream, Problems) is still yours: `tools/live/signedin_check.py`, with the password in your own shell. `server/src/__tests__/rebuild-script.test.ts` runs it as a dry run in temporary trees with a stand-in for docker.

Tags. A build is named by its commit (the sidebar footer, a signed-in `/api/health`). A tag says which commit was live: `live-YYYY-MM-DD`, annotated, one for each rebuild. There are no version numbers: both `package.json` files say 0.1.0, nobody consumes a version, and the commit says more.

After a restart. The portals come back with Docker. A local Zabbix database and frontend came back with them from 22 October 2026 (tracker IN-27) and were taken down on 29 October, when option B began, so there is nothing else to bring back. [`operations/after-a-restart.md`](../operations/after-a-restart.md) has the order and the check.

Rolling back. The BFF image can go back through compose: `docker tag <name>:rollback-<date> <name>:latest`, then `docker compose up -d --no-build portal-bff`. The web image of a build from before 7 October could not go back that way, because the 7 October compose maps container port 8080 and drops every capability, while the old image runs root nginx on port 80; no such image is left, since the tags `2oct` and `7oct` were removed on 19 October (below). Every tag that exists now was built for the current compose file, so both services should go back through compose with the same two commands, with a `rollback-<date>` tag or with `last-good` (not tried).

Keeping the rollback images (IN-28). Each rebuild leaves the images it replaced under a `rollback-<date>` tag. Keep the newest two tags of each of the four portal images (`hcml-portal-portal-bff`, `hcml-portal-portal-web`, `hcml-portal-ollama-portal-bff`, `hcml-portal-ollama-portal-web`) and remove the older ones once the build after them has run for a day with every container healthy: `docker rmi <name>:rollback-<date>`. That removes a tag; the layers go only when no other tag or container uses them. Look at the size with `docker system df`. `docker image prune` removes images that have no tag and `docker builder prune` the build cache; neither touches a tagged image, a container or a volume.

On 19 October 2026 Docker held 12.5 GB of images (7.7 GB of it reclaimable), 3.8 GB of build cache and 21 GB of volumes, and the portals had 20 rollback tags, five of each image (`2oct`, `7oct`, `13oct`, `14oct` and `14oct-2`). By this rule the three oldest of each image, 12 tags in all, were due. Most of the other images and volumes belong to other projects on the same machine and are not this rule's business.

The same day, at the owner's word, the 12 tags were removed (`2oct`, `7oct` and `13oct` of each of the four images; `14oct` and `14oct-2` stay) and so was the volume `proto1_pgdata`, which held the demo estate parked there before HCML's data was restored. Nothing used it (the running Zabbix stack mounts `proto1_mysqldata`), and `docker ps -a --filter volume=proto1_pgdata` named no container; `docker volume rm` cannot be undone, so that demo estate is gone. Images went from 33 entries to 21 and from 12.53 GB to 12.38 GB, volumes from 22 to 21 and from 21.07 GB to 20.87 GB, and the build cache (3.77 GB) was not touched. Little came back because the layers of an old tag are mostly shared with a newer one: the "reclaimable" figure of `docker system df` is not what removing tags frees. Every container stayed healthy.

On 22 October 2026 both portals were rebuilt by the script from the clean commit `1b15d95` (hosted at 09:36:28 WIB, ollama at 09:36:41). The four images they replaced are tagged `rollback-22oct`, so each image has three tags now (`14oct`, `14oct-2` and `22oct`); by the rule above `rollback-14oct` goes once this build has run a day with every container healthy: `docker rmi <name>:rollback-14oct` for each of the four. Done on 26 October 2026: the four `rollback-14oct` tags are removed, so each image keeps `rollback-14oct-2` and `rollback-22oct`.

On 26 October 2026, at 11:59 WIB, both portals were rebuilt again by `deploy/rebuild.sh --allow-dirty`, from the working tree, so the build reads `7bc48db-dirty` and has no `live-` tag. The four images it replaced are tagged `rollback-26oct`, so each image has `14oct-2`, `22oct` and `26oct`; by the rule above `rollback-14oct-2` goes once this build has run a day with every container healthy.

On 2 November 2026 `deploy/rebuild.sh` began to mark the images of a run that passes its checks `last-good` (tracker IN-47). Since 3 November 2026 it does not: a person marks them with `deploy/rebuild.sh --mark-good` once the signed-in check has passed (IN-52). The name moves with each marking and adds no image of its own. After a failed run its help names `last-good` first and the rollback tags it made after it, because after two failed runs on one day the rollback tag of the second run holds the first run's failed build. To go back: `docker tag <name>:last-good <name>:latest`, then `docker compose up -d --no-build` in that copy.

On 3 November 2026, in the evening, each of the four portal images had eight rollback tags (`29oct`, `29oct-2`, `30oct`, `30oct-2`, `2nov`, `2nov-2`, `3nov` and `3nov-2`). At the owner's word the six older ones of each image, 24 tags, were removed, after checking that no container used any of them and that none of them shared an image with a tag that stays. `rollback-3nov` (the build that was live from 20:36 on 2 November to 16:41 on 3 November) and `rollback-3nov-2` (16:41 to 17:12) stay, with `last-good` and `latest`. Images went from 47 entries to 23 and from 17.16 GB to 17.03 GB: little came back, because the layers of an old tag are mostly shared with a newer one. The four containers stayed healthy.

On 9 November 2026 at 15:41 WIB both portals were rebuilt by `deploy/rebuild.sh --allow-dirty --skip-verify`, after `npm run verify` had passed in both copies; both logs were saved first. The images it replaced are tagged `rollback-9nov`. The check with a sign-in passed 10 of 10 on a test copy of each new image (the hosted one with email on, the local-model one with it off), and `deploy/rebuild.sh --mark-good` then moved `last-good` to the new build on all four images. At the owner's word the four older rollback tags of each image (`rollback-3nov`, `rollback-3nov-2`, `rollback-4nov` and `rollback-4nov-2`, 16 tags) were removed: no container used them, and none shared an image with a tag that stays. `rollback-4nov-3` and `rollback-9nov` stay, with `last-good` and `latest`. The build of 3 November 17:12, which had been `last-good`, is no longer on this Mac.
