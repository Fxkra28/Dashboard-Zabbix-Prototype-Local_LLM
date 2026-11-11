# nginx, Docker and TLS

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Operators and developers | about 7 min | [AI providers](ai-providers.md) | [Sign-in](sign-in.md) |

## What it is for

Two containers make a portal. `portal-web` is nginx. It serves the built web app and passes every address that starts with `/bff` to the other container, so the browser talks to one site only. `portal-bff` is the server. Docker publishes nginx on the host's loopback address, on port 8081 for the hosted copy and 8082 for the local-model copy, and nowhere else. The repository ends no TLS: for anyone outside the host machine, a secure proxy has to be put in front.

## What nginx does

The whole file is `web/nginx.conf`, with one include, `web/bff-proxy.inc`. It listens on 8080, because the image runs nginx as a user that cannot bind a port below 1024, and Docker maps the host port onto it.

| Location | What happens | Why |
|---|---|---|
| `/bff/` | Rewritten to the server's own path, `/bff/api/hosts` becoming `/api/hosts`, and proxied. A read may take up to 360 s | Zabbix's largest reads take minutes |
| `/bff/api/sli` and `/bff/api/explain/` | The same, with 480 s | The SLA and an explanation take longer still |
| `/bff/api/stream` and `/bff/api/chat` | Unbuffered, with 3600 s | The live list and the Assistant's answer are streams. A buffering proxy would hold them back, and a local model can be silent for minutes while it loads |
| `/assets/` | Cached for a year, marked immutable | The build names each file by its content |
| `/fonts/` and the logos | Cached for 30 days and for a day | |
| Any other address that starts a segment with a dot | 404 | So `/.env` and `/.git/config` are never served, even by mistake |
| `/` and everything else | Falls back to `index.html`, with `Cache-Control: no-cache` | The app does its own routing |

Every static response carries a content-security policy that allows scripts, styles, fonts, images and connections from the site itself and nothing else (styles also inline, because ECharts and React set inline styles), forbids plugins and framing from other sites, and sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` and `Referrer-Policy: no-referrer`. No outside host is named: the fonts are served from `/fonts/`. The server version is hidden.

nginx resolves the name `portal-bff` at the time of each request, through Docker's resolver with a ten-second cache, and not once at start. So it starts when the server is down, and it follows the server when that is recreated.

The access log has one line for each request, with the request id as `rid=`, the same id the server logs and returns in `X-Request-Id`, so one id finds a request in both. A `token=` in an address is replaced by `redacted`, because an old page may still send one.

`bff-proxy.inc` is what every `/bff` location shares: the rewrite, the keep-alive connection to the server (no `Connection` header, because the streams need it open), the browser's own `Host` including its port (the server compares it with the `Origin` of every cookie POST), `X-Real-IP`, an appended `X-Forwarded-For`, and nginx's request id in place of whatever the client sent.

## What Docker does

`docker-compose.yml` defines the two services. Their settings are the same hardening, with different sizes.

| | `portal-bff` | `portal-web` |
|---|---|---|
| Image | Built from `server/`, with the commit and the time as build arguments | Built from `web/` |
| Reachable at | Port 4000 on the compose network only | `127.0.0.1:8081` (or 8082) on the host |
| Filesystem | Read-only, with a 16 MB `/tmp` | Read-only, with a 64 MB `/tmp` |
| Privileges | All capabilities dropped, no new privileges, and the `node` user | The same, and nginx as an unprivileged user |
| Limits | 2 GB of memory, 2 processors, and Node's heap capped at 1280 MB | 256 MB, 1 processor |
| Health check | Every 10 s, the server's `/api/health` | Every 30 s, the front page |
| Start order | First | After the server is healthy |
| Restart | `unless-stopped` | `unless-stopped` |
| Logs | JSON files of 50 MB, five kept | The same |

`init: true` on the server means a stop signal reaches Node, and the server closes its streams and exits inside the ten seconds Docker allows. The compose file refuses to start without `JWT_SECRET`, and the server refuses a value that is published in the repository or shorter than 32 bytes. Both Dockerfiles pin their base image by tag and digest and install from the lockfile with `npm ci`, so two builds of one commit give the same bytes. A `.dockerignore` in each package keeps the host's installed packages out, because ones built for a Mac would replace the ones built for Linux.

`restart: unless-stopped` brings a dead container back and a container someone stopped by hand stays stopped.

## TLS

The portal speaks plain HTTP. On the host that never leaves the machine, which is right for a laptop and wrong for anything else, since over a network the pages, the password and the session cookie would cross in the clear. [The TLS runbook](../../operations/tls.md) has the full recipe. The short version is that a proxy on the same machine must do five things:

1. End TLS and pass on to the portal's loopback port as plain HTTP.
2. Keep the browser's own `Host`.
3. Send `X-Forwarded-Proto: https`, or the session cookie is issued without `Secure`.
4. Not buffer responses.
5. Send HSTS.

Then set `WEB_ORIGIN` to the address people type and `TRUST_PROXY` to 2, which says two proxies stand in front of the server, nginx and yours. `true` is one hop and a number is that many. The portal stays bound to the loopback address, and the proxy is the only thing reachable from outside.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `WEB_PORT` | 8081, or 8082 in the local-model copy | The host port nginx is published on |
| `WEB_ORIGIN` | `http://localhost:8081`, or 8082 | The one origin the server's CORS allows. With sign-in off, the host name in it is also the only one, besides localhost, the server answers to |
| `TRUST_PROXY` | `true` | How many proxies stand in front of the server |
| `RATE_LIMIT_PER_MINUTE` | 300 | The overall limit for one client address |
| `STREAM_MAX_CLIENTS`, `STREAM_MAX_PER_USER` | 100, 5 | How many live screens in all, and for one signed-in user |
| `BUILD_COMMIT`, `BUILD_TIME` | `unknown` | Build arguments, not settings: the commit and the time `/api/health` shows. `deploy/rebuild.sh` passes them |

## How it fails

| What you see | Cause | What to do |
|---|---|---|
| The page loads and every call fails with a bad gateway | The server is down or unhealthy | `docker compose ps`, then the server's log. Docker restarts a container that has stopped, not one that is running and unhealthy: `docker compose restart portal-bff` |
| A call fails after exactly 360 or 480 seconds | A read longer than nginx waits | Find what is slow. Raise `ZABBIX_TIMEOUT_MS` and the nginx waits together, never one alone |
| 403 `csrf` after a proxy is put in front | The proxy changed `Host`, so it no longer matches the `Origin` the browser sent | Pass the browser's `Host` on unchanged |
| 421 `misdirected_request`, with sign-in off | The address people type is neither localhost nor the host name in `WEB_ORIGIN` | Set `WEB_ORIGIN` to the address people type |
| Everyone shares one rate limit, or addresses in the log are the proxy's | `TRUST_PROXY` does not match the number of proxies | Set it to 2 behind one proxy |
| Sign-in works but the cookie is not kept over HTTPS | No `X-Forwarded-Proto: https` | Send it |
| The Dashboard says Polling | A proxy buffers the stream | Switch buffering off for it |
| nginx will not start | A duplicate or broken directive | `nginx -t`. CI runs it, and `nginx-conf.test.ts` reads the file the way nginx does |
| New code does not appear | The image was not rebuilt | `deploy/rebuild.sh` |

## How to check it

From the host, with the right port: `curl -sI http://127.0.0.1:8081/` shows the content-security policy and the other headers. `/.env` and `/.git/config` answer 404. `docker compose ps` shows both containers and their health, `docker logs` their logs. In CI, `docker run --rm <the web image> nginx -t` checks the syntax. `tools/live/enforcing-csp-server.mjs` serves a build with the production policy so that a change can be tried before a rebuild.

## Where the code is

| What | File |
|---|---|
| nginx | `web/nginx.conf`, `web/bff-proxy.inc`, `web/Dockerfile` |
| The server image | `server/Dockerfile` |
| Both containers | `docker-compose.yml`, and `docker-compose.override.yml` on the machine |
| The checks of the nginx file | `server/src/__tests__/nginx-conf.test.ts` |
| The server's side of the proxy | `server/src/http/requestId.ts`, `server/src/http/rateLimit.ts`, `server/src/http/hostCheck.ts` |
