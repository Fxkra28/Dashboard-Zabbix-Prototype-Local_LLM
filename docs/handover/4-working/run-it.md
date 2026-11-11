# Run it: on a laptop, and day to day

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Operators and developers | about 8 min | [Operations](../3-integrations/operations.md) | [Deploy, rebuild and roll back](deploy-rebuild-rollback.md) |

This page has two halves. The first is how to start the portal on a development machine, in the shortest order that works. The second is a suggested round for whoever looks after the running portals: what to look at, how often, and what a normal answer looks like. The environment reference is the Configuration section of the repository's `README.md`, and this page does not repeat it.

## On a development machine

You need Node 24 and npm, a reachable Zabbix 7.0, and a read-only API token for it. A model endpoint is needed only to work on the plain-language layer: an Anthropic key for `hcml-portal`, or a running Ollama with `qwen3:8b` for `hcml-portal-ollama`. Everything else works without it.

1. Make the token in Zabbix: Users, Roles, a read-only role, then a user with that role scoped to the host groups the portal should see, then an API token. Test it before going further, since most first-run problems are the token: a `host.get` with `limit` 3 sent to `/api_jsonrpc.php` with `Authorization: Bearer <token>` must return a `result` array. An `error` about permissions means the role is too narrow.
2. Leave `ZABBIX_WRITE_TOKEN` unset unless you want the acknowledge button. Without it the portal sends no write, and `/api/health` says `writeBack: false` so the page hides the control. Acknowledge and close also need sign-in: a development server with `AUTH_ENABLED=false` refuses them even with the write token set, unless `ALLOW_WRITE_WITHOUT_AUTH=true` is added, and with sign-in off every caller is an admin, so do that only on a machine nobody else can reach.
3. Start the server: in `server/`, copy `.env.example` to `.env`, set `ZBX_URL` and `ZABBIX_API_TOKEN`, then `npm install` and `npm run dev`. It listens on port 4000.
4. Start the web app: in `web/`, `npm install` and `npm run dev`. Vite listens on port 5173 and passes `/bff` to port 4000. The prefix is `/bff`, not `/api`: Vite strips it and forwards. Calling `localhost:5173/api/...` by hand does not reach the server at all. It returns `index.html`, which looks like a working 200 until you read the body.
5. Check the server before opening the browser: `curl -s localhost:4000/api/health`. `ok: true` with `ai: false` is a correct and complete portal without the plain-language layer.

`ok` only says the process is up. `ready.ok` says the server can read Zabbix right now. When it cannot, `ready.zabbix` is `token_rejected` (the token was revoked or expired), `timeout` or `error`, and the reply is still a 200. The route is public: anyone gets `ready` as a plain `true` or `false`, and the version, the build, when the server started, how many screens are live and the reasons above go only to a signed-in caller. A stranger can see that Zabbix cannot be read and cannot learn that a token was revoked.

### In Docker

1. Copy `.env.example` to `.env` at the root and set `ZBX_URL`, `ZABBIX_API_TOKEN`, `JWT_SECRET` and `PORTAL_PASS`. `ZBX_URL` must be reachable from inside the container.
2. `docker compose up -d --build`. The hosted portal answers on port 8081 and the local-model portal on 8082, and the check is `curl -s localhost:8081/bff/api/health`.
3. On HCML's office network the name `zabbix.hcml.co.id` leads to a gateway that refuses the portal. A `docker-compose.override.yml` in each folder maps the name to Zabbix's LAN address for the server container, and the certificate is still checked against the name. The file names an internal address, so it stays on the machine and is never committed. [After a restart](../../operations/after-a-restart.md) has the details.
4. To make `/api/health` say which build runs, pass the commit and the time when building: `BUILD_COMMIT=$(git rev-parse --short HEAD) BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) docker compose up -d --build`. `deploy/rebuild.sh` does this for you.

### Signing in

Sign-in is on by default. With it on you need `PORTAL_USER` and `PORTAL_PASS`, or `PORTAL_USERS` as comma-separated `name:password:role` triples, and the server refuses to start while a password is empty or `admin`. It also needs a real `JWT_SECRET`, at least 32 bytes and not a value published in the repository: `openssl rand -hex 32` makes one, and a different one for each portal is better. A session lasts 12 hours unless `SESSION_HOURS` says otherwise, from 2 to 24, and an open portal renews it before then. Raise `SESSION_EPOCH` and recreate the server container to sign everyone out at once. Two portals on one machine need different `SESSION_COOKIE` names, because cookies ignore ports and signing in to one would sign you out of the other.

## A suggested round for whoever runs it

None of this is automatic except the watcher. It is a short list that fits in a few minutes, and the questions it asks are the ones that cost time when they are not asked.

| When | What to look at | A normal answer |
|---|---|---|
| Each morning | Both portals answer: the health address of each, `http://127.0.0.1:8081/bff/api/health` and the one on 8082 | `ok: true` and `ready: true`. Signed in, `ready.ok` is true |
| Each morning | Both containers of each portal, with `docker compose ps` in each folder | `healthy` for the server and for the web container |
| Each morning | The Dashboard's data clock and the notices above the lists | "Live", or a time that is no more than a few minutes old. No banner about a stopped collector |
| After any alert from the watcher | `deploy/watch.sh --status` | The last state and the last lines of its log say what it saw and when |
| After a change to a user, a role, a token, `JWT_SECRET` or a setting | An encrypted copy of the `.env` files, kept off the machine, and in the hosted copy a copy of `portal-state.json` after the saved list or the schedule changes | The restore check in [backup and restore](../../operations/backup-and-restore.md) passes |
| Each week | The rollback tags of each image, with `docker images` | The two newest are the ones to keep. Older ones go only when the owner says so |
| Each week | The pull requests that Dependabot opened, and whether CI has run | They are proposals. CI has not run on GitHub yet, because of a billing lock on the account |
| Each month | The base images of both portals: `docker buildx imagetools inspect node:24.22-alpine` against the three `FROM node:` lines of the two Dockerfiles, and `docker buildx imagetools inspect nginxinc/nginx-unprivileged:1.30-alpine` against the `FROM nginxinc/nginx-unprivileged:` line of `web/Dockerfile` (the tag of that image can stop moving: the 1.28 one did, in February 2026) | The same digest. A newer one means a patch of Node 24 or of nginx: put its tag and digest in the lines, rebuild both copies with `deploy/rebuild.sh`, and run the checks. A new major version of Node is a decision for the owner |

The watcher, `deploy/watch.sh`, is the one thing that tells someone. Every minute it asks each portal's health address and inspects the containers, and it says so once when a portal stops answering for two checks, answers again, turns unhealthy, restarts in a loop, or when Docker itself stops answering. [Operations](../3-integrations/operations.md) describes it, and `--install` makes a per-user timer on macOS.

## After a restart

The containers come back by themselves when Docker starts, because of `restart: unless-stopped`. On a Mac that needs Docker Desktop's setting to start when you sign in, a signed-in Mac, and the office network, where Zabbix's LAN address answers. Off it, the portals come back and say that the data source is not answering, and nothing false is recorded meanwhile.

After a start the server reads the slow views once, one at a time, so the first visitor finds them ready. Its log says `warm-up: done` when it has finished, and on 30 October 2026 the whole round took about four minutes on HCML's Zabbix. The Capacity report is the last in the round. The other reports, the SLA figures, the Graphs item list and the interfaces are not in it, so their first visit waits. A page that takes a minute the first time is normal. A page that takes a minute every time is worth a look: see [troubleshooting](troubleshooting.md).

## Who to tell

- The page says the data source is not answering for more than a few minutes, and the office network is fine: tell HCML IT. Zabbix is theirs. The portal records nothing meanwhile, and the notice at the top says how old the data on the page is.
- A banner says that Zabbix has collected nothing since a time, or that it cannot reach the network: the portal is reading a Zabbix that has stopped collecting. That is also for HCML IT, and the figures on the page are from that time and not from now.
- An account, a role or a password: the portal's administrator edits the users setting and recreates the server container (`docker compose up -d`).
