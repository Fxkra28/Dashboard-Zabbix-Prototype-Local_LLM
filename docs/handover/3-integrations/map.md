# The integration map

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Operators and developers | about 5 min | [Repository map](../1-folders/repository-map.md) | [Zabbix](zabbix.md) |

This page lists everything the portal talks to, in one table, with the credential each connection uses, the setting that points at it and what you see when it is down. The pages after it take one connection each. They all follow one pattern: what it is for, what the portal sends and what comes back, the settings, how it fails, how to check it, and where the code is.

![What the portal talks to: browsers reach nginx over plain HTTP on the same machine, or through an optional TLS proxy from other machines, nginx passes /bff to the server, and the server asks Zabbix, Anthropic or Ollama, and in the hosted copy a mail server. That copy's server also reads and saves a small state volume. The operator's scripts act on the containers, and GitHub holds the repository and runs its checks.](../diagrams/integrations-map.png)

The same picture as a [PDF](../diagrams/integrations-map.pdf). It draws the optional link from the server to a mail server and the `portal-state` volume, both in the hosted copy only; the table below lists the mail link with its settings.

## What it talks to

| Connection | Direction and protocol | Credential | What points at it | When it is down |
|---|---|---|---|---|
| A browser to nginx | HTTP, or HTTPS through the proxy you put in front | A session cookie | `WEB_ORIGIN`, `WEB_PORT` | No portal for that person |
| nginx to the server | HTTP over the compose network, under the address `/bff` | None. nginx adds a request id | The proxy settings of `web/nginx.conf` | Every page loads and then fails on its first call |
| The server to Zabbix | JSON-RPC 2.0 over HTTPS, POST | A read token, and a separate write token for the one write | `ZBX_URL`, `ZABBIX_API_TOKEN`, `ZABBIX_WRITE_TOKEN`, `ZABBIX_TIMEOUT_MS`, `ZBX_TLS_PIN_SHA256`, `ZBX_TLS_PIN_UNTIL` | Pages say "The data source is not answering". [Zabbix](zabbix.md) |
| The server to Anthropic | HTTPS through Anthropic's SDK, on request | `ANTHROPIC_API_KEY` | `AI_PROVIDER`, `AI_MODEL`, `AI_TIMEOUT_MS`, the `AI_*` limits | Explain and the Assistant fail with a fixed sentence. The rest is unaffected. [AI providers](ai-providers.md) |
| The server to Ollama | HTTP to the host machine, on request | Usually none | `AI_BASE_URL`, `AI_MODEL`, `AI_KEEP_ALIVE`, `AI_NUM_CTX` | The same |
| The server to a mail server | SMTP over TLS or STARTTLS, only when an administrator emails the SLA report or the monthly send runs. The hosted copy only | A login (`MAIL_USER`, `MAIL_PASS`), or none | The `MAIL_` settings, among them `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURITY` and `MAIL_ALLOWED_DOMAINS` | No email, with a sentence that says why. Every page is unaffected. [Report files](reports-exports.md#emailing-a-report) |
| The operator's scripts to Docker | `docker compose` and `docker inspect` | The operator's own access to Docker | The compose file and `deploy/` | Nothing runs, or nobody is told when it stops. [Operations](operations.md) |
| A TLS proxy to nginx | HTTP on the loopback address | The proxy's certificate | `TRUST_PROXY`, `WEB_ORIGIN`. Not in the repository | Outside machines cannot reach the portal. [nginx, Docker and TLS](nginx-docker-tls.md) |
| Developers to GitHub | git, GitHub Actions, Dependabot | The developer's GitHub account | `.github/` | No remote checks. The portal is unaffected. [GitHub and CI](github-ci.md) |

Three connections carry secrets and are worth knowing by name. The Zabbix tokens, the model key and, in the hosted copy, the mail password (`MAIL_PASS`) live in the settings file on the host, reach the server container through its environment, are read by `server/src/core/config.ts` and are used by four files: `server/src/clients/zabbix.ts`, `server/src/clients/ai.ts`, `server/src/clients/mail.ts` and, for the model key in the readiness check of a local server, `server/src/http/health.ts`. No route returns them. The session secret signs the cookie and never leaves the server either; [sign-in](sign-in.md) has the rest.

## What the portal does not talk to

No database, no message queue, no cache server and no third-party script, font or analytics. The browser may contact only its own site: the content-security policy in `web/nginx.conf` allows nothing else. The only outside systems are Zabbix, one of the two model providers and, in the hosted copy and only once its mail settings are filled in, a mail server.

## Who owns each side

| Side | Owner |
|---|---|
| Zabbix, its network path, its certificate and its database | HCML IT |
| The host machine, Docker, the TLS proxy and the backups of the settings | The operator |
| The portal's code, settings and accounts | The portal's owner |
| The hosted model | Anthropic. The terms are HCML's to read before the hosted copy is used on real data |
| The mail account and its server | The portal's owner today, with a personal Gmail account. HCML's own mail is the open item IN-58 |
| The repository and its checks | The owner, on GitHub |

## How a setting reaches the server

![A setting in the .env file and the compose file becomes the container's environment, which core/config.ts reads once at start. A check refuses an unsafe configuration, while a MAIL_ setting that cannot be used leaves only email off. Apart from the settings, the recipients and the monthly schedule are typed in the portal and saved by the server in a small file on a volume.](../diagrams/settings-flow.png)

The server reads its settings once, when it starts. Changing one means editing the settings file and recreating the server container, as the [operations page](operations.md) says.
