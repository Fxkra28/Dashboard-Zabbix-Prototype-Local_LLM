# TLS: reaching the portal from another machine

The portal speaks plain HTTP. In Docker, nginx in the `portal-web` container listens on port 8080, and
Docker publishes it on `127.0.0.1:8081` (`127.0.0.1:8082` for `hcml-portal-ollama`) and nowhere
else. On the machine that runs it, that traffic never leaves the machine. Nothing in this repository
terminates TLS (tracker IN-26).

That is right for a laptop and wrong for anything else. Over a network, the pages, the sign-in
password and the session cookie would all cross it in clear. So for any deployment beyond localhost,
put a TLS proxy in front of the web container, **on the same machine**, and leave the portal's own
nginx as it is. The portal stays bound to `127.0.0.1`: the proxy is the only thing that should be
reachable from outside, so do not change the `127.0.0.1:` in `docker-compose.yml`.

## What the proxy must do

1. **Terminate TLS** and forward to the portal's loopback port as plain HTTP.
2. **Keep the browser's `Host` header.** The BFF refuses a sign-in, or any other cookie `POST`,
   whose `Origin` does not name the `Host` it receives (403 `csrf`).
3. **Send `X-Forwarded-Proto: https`.** Without it the BFF takes the request for plain HTTP and
   issues the session cookie without `Secure`.
4. **Not buffer responses.** The live Dashboard and the assistant's answers are event streams, and
   the assistant can be silent for minutes while a local model loads.
5. **Send HSTS**, described [below](#hsts).

Then set two values in `.env` and recreate the BFF with `docker compose up -d`:

```text
WEB_ORIGIN=https://portal.example.com
TRUST_PROXY=2
```

`WEB_ORIGIN` is the address people type. `TRUST_PROXY=2` says two proxies stand in front of the BFF,
the portal's nginx and yours, so the BFF reads the client's address from the right entry of
`X-Forwarded-For` and the rate limit stays per client. `setup.md` §23 has the rule: `true` is one
hop, and a number is that many.

## Option A: nginx in front

A second nginx, on the host. If it runs in a container on the compose network instead, point
`proxy_pass` at `http://portal-web:8080`.

```nginx
server {
  listen 80;
  server_name portal.example.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl;
  server_name portal.example.com;

  ssl_certificate     /etc/ssl/portal/fullchain.pem;
  ssl_certificate_key /etc/ssl/portal/privkey.pem;
  ssl_protocols       TLSv1.2 TLSv1.3;

  # Raise 300 to 31536000 once every address people use has been checked.
  add_header Strict-Transport-Security "max-age=300" always;

  location / {
    # 8082 for hcml-portal-ollama.
    proxy_pass http://127.0.0.1:8081;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # The BFF sends no HSTS header of its own (see below). This keeps a second one from arriving
    # beside the proxy's if someone turns helmet's on.
    proxy_hide_header Strict-Transport-Security;
    # Event streams: no buffering, and an hour between two reads.
    proxy_buffering off;
    proxy_read_timeout 3600s;
  }
}
```

The portal's own nginx still sets the real limit for each route (360 seconds for an ordinary call, 480 for the SLA and for explanations),
so the hour here only lets the streams run.

## Option B: Caddy

Caddy gets and renews a certificate by itself for a public name. For a name only your network knows,
add `tls internal` (Caddy's own certificate authority) or `tls /path/fullchain.pem /path/privkey.pem`
inside the block. It redirects HTTP to HTTPS without being asked, and sends `X-Forwarded-Proto` and
the browser's `Host` by default.

```caddyfile
portal.example.com {
	# Raise 300 to 31536000 once every address people use has been checked.
	header Strict-Transport-Security "max-age=300"
	# 8082 for hcml-portal-ollama. flush_interval -1 sends each event as it arrives.
	reverse_proxy 127.0.0.1:8081 {
		flush_interval -1
	}
}
```

## Option C: Traefik

With Traefik in the same compose project, label the web service. Its entry points, its certificate
resolver and the redirect from HTTP are set up as in Traefik's own documentation, and the labels
below only say what is special about this stack. Traefik sends `X-Forwarded-Proto` and keeps the
`Host` by default.

```yaml
services:
  portal-web:
    labels:
      - traefik.enable=true
      - traefik.http.routers.portal.rule=Host(`portal.example.com`)
      - traefik.http.routers.portal.entrypoints=websecure
      - traefik.http.routers.portal.tls=true
      - traefik.http.routers.portal.middlewares=portal-hsts
      - traefik.http.services.portal.loadbalancer.server.port=8080
      # Raise 300 to 31536000 once every address people use has been checked.
      - traefik.http.middlewares.portal-hsts.headers.stsSeconds=300
```

## HSTS

HSTS tells a browser to use HTTPS for this name and to refuse plain HTTP until the time runs out.
Start with `max-age=300`, five minutes, while you check every address people use, then raise it to
`31536000`, a year. A year cannot be taken back from the server: a browser that has seen it keeps
refusing HTTP until it expires. Leave out `includeSubDomains` and `preload` unless you control every
name under the domain.

The portal itself is served over plain HTTP, so the BFF sends no `Strict-Transport-Security` header
(`hsts: false` in `server/src/index.ts`): it would claim a TLS that is not there. Neither do the pages
and files that nginx serves. The proxy in front has to add the header, to every reply, and then it
is the only one. A browser uses only the first such header it receives, which is why the nginx recipe
also hides one if the BFF were ever to send its own.

## Check that it works

```bash
curl -sI http://portal.example.com/ | head -1                                  # 301, to https
curl -sI https://portal.example.com/ | grep -i strict-transport-security       # the page carries it
curl -sI https://portal.example.com/bff/api/health | grep -ci strict-transport # 1: the proxy's, and only that
```

Then sign in in a browser and open the developer tools. The `hcml_session` cookie (or
`hcml_session_ollama`) must be marked `Secure`. If it is not, `X-Forwarded-Proto` is not reaching the
BFF. If sign-in answers 403 `csrf`, the proxy is not passing the browser's `Host`.

## When Zabbix's own certificate has expired

With an `https://` address in `ZBX_URL`, the BFF checks Zabbix's certificate as a browser would. An
expired one is refused: the BFF log says `CERT_HAS_EXPIRED` and every page says the data source is
not answering. The fix is a renewed certificate. Until it arrives, two settings let the BFF accept
the one certificate it already knows, up to a day you choose:

```bash
ZBX_TLS_PIN_SHA256=<the certificate's SHA-256 fingerprint>
ZBX_TLS_PIN_UNTIL=2026-11-30     # accepted until 23:59 WIB that day
```

The exception (`server/src/clients/pinnedTls.ts`) still refuses:

- any other certificate, one for the same name included. The fingerprint must match, and the
  handshake proves the server holds that certificate's key;
- a certificate with any fault besides its age, or one that does not name the host in `ZBX_URL`;
- everything after the last day. Connections opened earlier are closed then, so none carries a
  request past it.

The connection is judged before the request is written, so a refused server never receives the
token. A certificate that passes the normal check, the renewed one for example, goes through as
before: renewal needs no change here, and the two lines can then be deleted. Other HTTPS
connections, such as the AI provider's, keep the normal check. The BFF warns at every start while
the lines are set.

Take the fingerprint from a check of the chain, not from the BFF's error. Node names only the last
fault it finds, and age is checked last, so "expired" alone does not show who signed the
certificate. `-no_check_time` makes OpenSSL check everything except the dates:

```bash
host=zabbix.example.com
openssl s_client -connect "$host:443" -servername "$host" -showcerts </dev/null 2>/dev/null \
  | awk '/BEGIN CERT/{n++; on=1} on{print > (n == 1 ? "leaf.pem" : "chain.pem")} /END CERT/{on=0}'
# A server that sends only its own certificate leaves no chain.pem: fetch the issuer the certificate names.
[ -s chain.pem ] || curl -s "$(openssl x509 -in leaf.pem -noout -ext authorityInfoAccess | sed -n 's/.*CA Issuers - URI://p')" \
  | openssl x509 -inform DER -out chain.pem
openssl verify -no_check_time -untrusted chain.pem leaf.pem   # leaf.pem: OK
openssl x509 -in leaf.pem -noout -fingerprint -sha256         # the value for ZBX_TLS_PIN_SHA256
```

`-ext` and `-no_check_time` need OpenSSL 1.1.1 or newer. The `openssl` that macOS ships is LibreSSL 3.3 and refuses both options (it prints "unknown option -ext" or its usage text); use the one from Homebrew, `$(brew --prefix openssl)/bin/openssl`.

## What was tested

The fingerprint commands above were run against HCML's Zabbix on 27 October 2026. Its server sent
only its own certificate, which is why the `chain.pem` step is there; the same gap makes Node refuse
even a renewed certificate unless the server is set to send the GeoTrust intermediate with it.

These recipes were written from each product's documentation and from how this portal reads its
headers (`server/src/security/auth.ts`, `setup.md` §23, ADR-0010). They were **not run** against a live
proxy: nothing here could start one. Before you rely on one, run `nginx -t` or `caddy validate`,
and the three `curl` checks above. The checks that do run in CI are the ones in
`server/src/__tests__/deploy-docs.test.ts`: they only confirm that this page still names HSTS, the
forwarded protocol and the two settings.
