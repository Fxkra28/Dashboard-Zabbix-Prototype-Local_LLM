# 1. The big picture

[setup.md](../../setup.md) · next: [§2](02-request-lifecycle.md)

The portal is a read-only, branded front-end for Zabbix. Zabbix keeps doing what it's good at:
collecting metrics (agents, SNMP, ICMP), evaluating triggers, storing history. The portal is a
separate app that reads that data through the Zabbix JSON-RPC API and presents it as an
HCML-branded NOC dashboard.

```
 ┌─────────────────────────┐   HTTP + SSE       ┌──────────────────────────┐   JSON-RPC 2.0    ┌───────────────┐
 │  Browser (React SPA)     │ ─────────────────► │  BFF  (Fastify + TS)      │ ────────────────► │  Zabbix API    │
 │  http://localhost:5173   │ ◄───────────────── │  http://localhost:4000    │ ◄──────────────── │  :8080         │
 │  • no token              │   /bff/api/*       │  • holds the token        │  host.get, ...    │  → MySQL       │
 │  • never talks to Zabbix │                    │  • caches, aggregates     │                   └───────────────┘
 └─────────────────────────┘                    └──────────────────────────┘
```

The first arrow is plain HTTP on this computer's loopback address: nginx listens on port 8080 inside
its container and Docker publishes it on `127.0.0.1` only. Nothing in this repository terminates
TLS, so before the portal is reached from another machine, put TLS in front of it:
[`docs/operations/tls.md`](../operations/tls.md).

Three hard rules drive the whole design (from the original build brief, `myown/documents/plan/instruct.md`
§0, outside both repos, so quoted rather than linked):

1. The browser never calls Zabbix. Only the BFF has the API token.
2. Read-only, least privilege. The portal reads with a dedicated read-only token (HCML's deployment does
   not meet this yet: its tokens belong to a Super admin, tracker SC-23). The single
   exception is acknowledge/close, which uses a separate write token and is off unless
   configured. See [§20](20-acknowledge-close-write-back.md#20-acknowledge--close-write-back).
3. Cache everything. Every Zabbix call hits its server + DB, so responses are cached with short TTLs.

## Why a BFF (Backend-for-Frontend)?
- Security: the long-lived Zabbix token stays server-side. If it were in the browser, anyone
  could read it from dev-tools and hit Zabbix directly.
- Shaping: Zabbix's API is raw and chatty (e.g. `problem.get` doesn't include host names). The
  BFF *enriches* and *aggregates* so the UI gets exactly the shape it needs in one call.
- Caching: the BFF absorbs repeated/polled requests so a busy dashboard doesn't hammer Zabbix.
- Decoupling: Zabbix upgrades don't break the portal; it only depends on the stable API.
