# Getting Started

The shortest path from a clone to a working portal. The full environment reference is in
[`../README.md`](../README.md) § Configuration: this page does not repeat it.

## Prerequisites

* Node.js 24 (LTS) and npm. The three `package.json` files allow Node 24 only (`engines`: `>=24 <25`),
  as the images and CI do
* Docker Engine 20.10 or later (the compose files use `host-gateway`) with the Compose v2 plugin (`docker compose`; the scripts name the containers `...-1`), for the deployment route
* A reachable Zabbix 7.0 and a read-only API token for it
* A model endpoint, only if you want the plain-language layer: an Anthropic API key in
  `hcml-portal`, a running Ollama with `qwen3:8b` in `hcml-portal-ollama`. Everything else works
  without it.

## 1. A Zabbix token

In Zabbix: *Users → Roles* → a read-only role; *Users → Users* → a user with it, scoped to the host
groups the portal should see; *Users → API tokens* → generate and copy.

Most first-run problems are the token, so smoke-test it before going further:

```bash
curl -s https://zabbix.hcml.co.id/zabbix/api_jsonrpc.php \
  --resolve zabbix.hcml.co.id:443:<LAN address> \
  -H 'Content-Type: application/json-rpc' \
  -H 'Authorization: Bearer <TOKEN>' \
  -d '{"jsonrpc":"2.0","method":"host.get","params":{"output":["hostid","name"],"limit":3},"id":1}'
```

On HCML's office network the name leads to a Zero Trust gateway that refuses the portal, so `--resolve`
sends the request to Zabbix's LAN address, the one in `docker-compose.override.yml`, and the certificate
is still checked against the name.

A JSON `result` array means you are ready. An `error` about permissions means the role is too narrow.

**Leave `ZABBIX_WRITE_TOKEN` unset** unless you want the acknowledge button. Without it the portal
sends no write, provided the read token's role is read-only as step 1 asks (tracker SC-23), and `/api/health`
reports `writeBack: false` so the UI hides the control.
[ADR-0006](architecture/adr/0006-read-only-with-one-write.md).

Acknowledge and close also need sign-in. A dev server with `AUTH_ENABLED=false` refuses them, even
with the write token set, unless you add `ALLOW_WRITE_WITHOUT_AUTH=true` to `server/.env`. With sign-in
off every caller is an admin, so only do that on a machine nobody else can reach. Every message the
portal sends to Zabbix starts with `[portal:<user>]`, since Zabbix files the write under the token's owner.

## 2. Run it, two processes

```bash
cd server && cp .env.example .env    # then set ZBX_URL and ZABBIX_API_TOKEN, and see §4
npm install && npm run dev           # BFF on :4000

cd ../web
npm install && npm run dev           # Vite on :5173, proxying /bff to :4000
```

The prefix is `/bff`, not `/api`: Vite strips it and forwards to the BFF, so the browser only ever
talks to one origin and never sees Zabbix. Calling `localhost:5173/api/...` by hand does not reach
the BFF at all, it returns `index.html`, which looks like a working 200 until you read the body.

Check the BFF before opening the browser:

```bash
curl -s localhost:4000/api/health
# With sign-in off, as in the dev server/.env, you get all of this. With sign-in on, a call with no
# session gets only ok, ts, ai, aiProvider, aiExternal, writeBack, defaults and ready as true or false (see below).
# {"ok":true,"ts":…,"ai":false,"writeBack":false,"defaults":{…},"version":"0.1.0","startedAt":"…",
#  "build":{"commit":"unknown","time":"unknown"},"ready":{"ok":true,"zabbix":"ok","zabbixMs":41,…},"streams":0}
```

`ok: true` with `ai: false` is a correct, complete portal without the plain-language layer.

`ok` only says the process is up. `ready.ok` says the BFF can read Zabbix right now: when it cannot,
`ready.zabbix` is `token_rejected` (the token was revoked or expired), `timeout` or `error`, and the
reply is still a 200. The check is one cheap call, at most once every 15 s however often health is polled.
`build` shows the commit and time the image was built with (`unknown` unless they were passed, see
section 3). The route is public, but the version, the build, when it started, how many screens are live
and the reason Zabbix cannot be read go only to a signed-in caller (a session cookie or a Bearer token),
so a stranger sees `ready: false` and cannot learn that the Zabbix token was revoked. An unsigned call, or a bad token, gets the
basic fields (`ok`, `ts`, `ai`, `aiProvider`, `aiExternal`, `writeBack`, `defaults`) and `ready` as `true` or `false`, with a 200. Neither reply ever carries an address or a token.

## 3. Or run it in Docker

```bash
cp .env.example .env && chmod 600 .env   # then set ZBX_URL, ZABBIX_API_TOKEN, JWT_SECRET, PORTAL_PASS
docker compose up -d --build         # hcml-portal → :8081 · hcml-portal-ollama → :8082
curl -s localhost:8081/bff/api/health   # :8082 in the ollama copy
```

`ZBX_URL` is HCML's Zabbix, `https://zabbix.hcml.co.id/zabbix/api_jsonrpc.php`, and it must be
reachable from inside the container. On HCML's office network the name leads to a Zero Trust gateway
that refuses the portal, so a `docker-compose.override.yml` maps it to Zabbix's LAN address
([docs/operations/after-a-restart.md](operations/after-a-restart.md)).

To make `/api/health` say which build is running, pass the commit and time when you build, and
`build` shows them instead of `unknown`:

```bash
BUILD_COMMIT=$(git rev-parse --short HEAD) BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) docker compose up -d --build
```

The BFF container has a healthcheck on `/api/health`, so `docker ps` shows `healthy`. It checks that the
process answers, not Zabbix (that is `ready` in the reply), and `portal-web` starts
once it is healthy.
`docker compose stop` and `restart` end the live streams and exit within a few seconds instead of
waiting out Docker's 10 s.

## 4. Signing in

With `AUTH_ENABLED=false`, an opt-in for local work (the default is `true`), there is no login and every caller is treated as
`admin`. With it on you need `PORTAL_USER`/`PORTAL_PASS`, or `PORTAL_USERS` as comma-separated
`name:password:role` triples, and the BFF refuses to start while any of those passwords is empty or
`admin`. Sign-in allows 10 attempts a minute per account from one address.

**Turning auth on also requires a real `JWT_SECRET`**: the BFF refuses to boot on either value
published in this repo, or on one shorter than 32 bytes. Generate one with `openssl rand -hex 32`,
and prefer a different secret per portal. A token names its portal (the cookie name decides), so one
portal refuses the other's session even with a shared secret, but a leaked shared secret would forge sessions
on both.

The browser keeps the session in an httpOnly cookie, `hcml_session` by default, that no script on the
page can read; signing out clears it. Cookies ignore ports, so two portals on one machine also need
different `SESSION_COOKIE` names, or signing in to one signs you out of the other. hcml-portal-ollama's
`docker-compose.yml` sets `hcml_session_ollama` for that reason.

A sign-in lasts 12 hours unless `SESSION_HOURS` says otherwise (2 to 24), and an open portal renews it
before then. To sign everyone out at once, raise `SESSION_EPOCH` and restart the BFF (in Docker, recreate its container with `docker compose up -d`).

Both `.env.example` files ship `AUTH_ENABLED=true` with `JWT_SECRET` and `PORTAL_PASS` empty, so a
freshly copied `.env` will not start until both are filled in, or, for local work only,
`AUTH_ENABLED=false` is set.

## What you should see

Signed in, the first page is the Dashboard. The names here are stand-ins; [`screenshots/`](screenshots/README.md)
has the other main pages, the Dashboard's other views, the dark theme and the narrow-screen layout.

![The Dashboard: counts for the estate, the live list of open problems and problems by host group](screenshots/dashboard.png)

## Checks you can run

From the repository root, everything at once (the typechecks, the lint, both test suites, both builds and
every checker), or the checkers alone:

```bash
npm run install:all                       # npm ci in server/ and in web/
npm run verify
npm run check                             # the checkers alone
```

Or one at a time:

```bash
cd server
npm test                                  # 2976 tests, 117 files
npm run lint                              # eslint
npm run typecheck
npx tsx scripts/validate-sli.ts           # the derived SLA against HCML's published reports

cd ../web
npm test                                  # 1769 tests, 114 files, in jsdom
npm run lint                              # eslint
npm run typecheck
npm run gen:api                           # web/src/generated/openapi.ts, from docs/api/openapi.yaml

cd ..                                     # the repository root again
npm run check:api                         # the API contract matches the code
npm run check:erd                         # the database ERD matches its .erd model
npm run check:styles                      # the stylesheet parts, and contrast with no raw values past the tokens
npm run check:web                         # the assistant's markdown renderer and the unit formatters
npm run check:docs                        # every relative link resolves, every diagram source matches its stamp
npm run check:parity                      # the two copies match (needs both folders side by side)
```

The checkers add zero dependencies: they are standalone scripts. The tests and lint of both packages, and the web's generated API types, use
vitest, eslint and openapi-typescript, dev dependencies that never reach the built site.
`validate-sli.ts` needs HCML's Availability Report spreadsheets in `~/Downloads` (or in `REPORT_DIR`) and a running BFF (`BFF_URL`
says where it is, `http://127.0.0.1:4000` by default; behind nginx it is the portal's address with `/bff` added). A month with no spreadsheet is skipped with one line. With sign-in on, set `PORTAL_USER` and `PORTAL_PASSWORD` in your own shell, as for `signedin_check.py`: the script signs in once and sends the cookie. It exits 0 when every month it checked passed, 1 when one failed, and 2 when nothing was checked or the portal could not be reached or signed in to.

## When it does not work

| Symptom | Cause |
|---|---|
| `503 zabbix_auth` | Zabbix rejected the API token. Re-run the curl in step 1 |
| `503 zabbix_timeout` | Zabbix did not answer within `ZABBIX_TIMEOUT_MS`, default 300 s in Docker and 10 s in a bare run |
| `502 zabbix_error` | Unreachable, non-2xx, or a JSON-RPC error. Check `ZBX_URL` first |
| `401 unauthorized` | The portal JWT, not the Zabbix token. Sign in again |
| `403 csrf` | A POST sent with the session cookie, or a sign-in, without the `X-HCML-CSRF: 1` header, or from another site. A script adds the header to sign in and then sends `Authorization: Bearer` |
| Signing in to one portal signs you out of the other | Both portals use the same `SESSION_COOKIE` on one host. Give each its own name |
| BFF will not start, complains about the secret | `AUTH_ENABLED=true` with `JWT_SECRET` empty, a value published in this repo, or shorter than 32 bytes |
| BFF will not start, complains about a password | `AUTH_ENABLED=true` with `PORTAL_PASS` empty or `admin`, or a `PORTAL_USERS` entry whose password is `admin` |
| `429` on sign-in | More than 10 attempts in a minute on one account from one address, more than 300 requests in a minute from that address, or 10 failed sign-ins in a row, which lock the account from that address for 1 to 5 minutes. Wait for the time the message gives |
| Pages load but every panel is empty | The token's role cannot see the host groups |

Full status-code semantics, including why nothing ever returns 504, are in
[`api/openapi.yaml`](api/openapi.yaml).

## Next

* [`index.md`](index.md), what else is documented and where
* [`architecture/adr/0001-bff-over-zabbix-api.md`](architecture/adr/0001-bff-over-zabbix-api.md), why there is a portal at all
* [`../setup.md`](../setup.md) §12: the recipe for adding a Zabbix-backed view
