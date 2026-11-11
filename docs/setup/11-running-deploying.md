# 11. Running & deploying

[setup.md](../../setup.md) · previous: [§10](10-network-monitoring.md) · next: [§12](12-extending-the-portal.md)

Dev (two processes):
```bash
cd server && cp .env.example .env   # set ZBX_URL + ZABBIX_API_TOKEN; auth needs JWT_SECRET + PORTAL_PASS
npm install && npm run dev          # BFF on :4000  (tsx watch, auto-reloads)
cd ../web && npm install && npm run dev   # Vite on :5173, proxies /bff -> :4000
```

`tsx watch` does not watch `.env`: after editing it, restart the BFF.

Prod (Docker, next to Zabbix):
```bash
cp .env.example .env && chmod 600 .env   # ZBX_URL, ZABBIX_API_TOKEN, a real JWT_SECRET and PORTAL_PASS
docker compose up -d --build        # nginx serves web + reverse-proxies /bff -> BFF, on :8082
```

To have `/api/health` say which build is running, pass the commit and time as build arguments:
`BUILD_COMMIT=$(git rev-parse --short HEAD) BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) docker compose up -d --build`.
They are not BFF settings and not read from `.env` by the running container, and they read `unknown`
when left out. `portal-bff` has a healthcheck on `/api/health` (it passes while the process answers,
whether or not Zabbix does, so a Zabbix outage never restarts the BFF) and `init: true`, and
`portal-web` starts once the BFF is healthy. Read the body, not the status, to see Zabbix: `ready.ok` (a signed-in call has it; an anonymous `curl` gets `ready` as `true` or `false`).
To rebuild both portals from the commit and check them, run `deploy/rebuild.sh` in `hcml-portal` (this copy has no git; [§23](23-hardening-timeouts-rate-limiting-headers.md)), with `--dry-run` first.

Four things about the Docker path that are easy to get wrong, and were:

1. `JWT_SECRET` has no default. Compose refuses to interpolate without it, and the BFF exits if
   it is one of the two values published in this repo or shorter than 32 bytes. An authenticated
   portal signing tokens with a value published in this repo looks perfectly healthy while anyone
   can forge an admin token, so this fails loudly rather than warning. `PORTAL_PASS` has no default
   either (it was `admin`), and the BFF also exits while any user's password is empty or `admin`.
2. `ZBX_URL` defaults to HCML's Zabbix, `https://zabbix.hcml.co.id/zabbix/api_jsonrpc.php`. From
   HCML's office network that name leads to a Zero Trust gateway that refuses the portal, so a
   `docker-compose.override.yml`, kept on the machine and out of git, maps it to Zabbix's LAN
   address for `portal-bff`. `localhost` inside the container means *the container*, which is why
   `server/.env`'s dev value must not be reused verbatim.
3. `.dockerignore` is load-bearing. `web/Dockerfile` does `COPY . .` after `npm ci`; without it
   the host's platform-specific `node_modules` lands on top of the linux one and `vite build` fails
   on Rolldown's (and lightningcss's) platform binaries; before Vite 8 it was esbuild's. That is why the image could not be built at all before 2026-09-08.
4. With an `https://` `ZBX_URL`, the BFF checks Zabbix's certificate and refuses an expired one.
   While it is being renewed, `ZBX_TLS_PIN_SHA256` and `ZBX_TLS_PIN_UNTIL` accept that one
   certificate until a set day: see `docs/operations/tls.md`.

Upgrading from a build before the session cookie (Batch 5, ADR-0010). Reload every open portal
tab right after the deploy, and sign in again, wall screens included. A page loaded before it keeps
its token in `localStorage`, which the new build deletes: its live stream stops (it still sends
`?token=`), its renewals come back without a token and look failed, and when its token ends it lands
on the sign-in form. Those renewals also set the new session cookie, which the old page's Sign out
cannot clear, so a browser left like that can stay signed in behind the sign-in form. A reloaded tab
runs the new build, whose Sign out clears the cookie.

Upgrading from a build before issuer and audience (7 October 2026, SC-14). Reload every open portal tab and sign in again: tokens issued before the deploy carry no issuer or audience and are refused (§19).

Verify the chain any time:
```bash
curl localhost:4000/api/health                  # BFF alive (dev)
curl localhost:8082/bff/api/health              # browser → nginx → BFF (prod)
curl -sI localhost:8082/reports/availability    # 200 = SPA fallback works on deep links
```

Beyond localhost, and backups. The Docker path speaks plain HTTP and publishes only on
`127.0.0.1`. To reach the portal from another machine, put TLS in front of it and set `WEB_ORIGIN`
to the `https://` address and `TRUST_PROXY=2`:
[`docs/operations/tls.md`](../operations/tls.md) has an nginx, a Caddy and a Traefik recipe, with
HSTS. The portal's only state is its `.env` files:
[`docs/operations/backup-and-restore.md`](../operations/backup-and-restore.md) says how to keep an
encrypted copy and how to restore from it, and `deploy/settings.example` lists every non-secret
setting with its default.
