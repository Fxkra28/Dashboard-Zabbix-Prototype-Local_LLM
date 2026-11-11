# One request, from start to finish

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 5 min | [The folders of the server](../1-folders/server.md) | [Server: the core and the clients](server-core-and-clients.md) |

This page follows one request from the browser to Zabbix and back, in the order the code runs it. It is the map of the server chapters that come after it. Each step says where it is in the code and which chapter walks through it. The request is an ordinary read, `GET /api/hosts/overview`, asked by a signed-in viewer.

The repository already has a sequence diagram of the same path, [ServerFlow](../../flow/ServerFlow.pdf), and the nine flows in words in [the flow page](../../flow/README.md). This page does not repeat them. It adds the code behind each step, and the checks that a diagram has no room for.

The same path in eight plain steps, with what the portal is built on, is in [Choices compared](../5-reference/choices-compared.md).

## The steps

| # | What happens | Where in the code | Walk-through |
|---|---|---|---|
| 1 | The browser asks nginx for `/bff/api/hosts/overview`. nginx rewrites it to `/api/hosts/overview`, makes a request id, and passes it to the server container | `web/nginx.conf`, `web/bff-proxy.inc` | [nginx, Docker and TLS](../3-integrations/nginx-docker-tls.md) |
| 2 | Fastify takes the request and gives it an id: a safe `X-Request-Id` that arrived, or a new one | `genReqId` in `server/src/http/requestId.ts` | [Server: security and http](server-security-and-http.md) |
| 3 | The id goes on the reply, and into the body of every error. This hook is registered first, so the refusals below carry it too | `registerRequestId` | the same |
| 4 | With sign-in off, only a request whose Host names this machine is answered, so a page on another site cannot reach a development server | `registerHostCheck` | the same |
| 5 | Security headers are added, and CORS allows one origin only, `WEB_ORIGIN`. The content-security policy is not set here, since nginx serves the app and this process serves JSON | `helmet` and `cors` in `server/src/index.ts` | the same |
| 6 | The rate limit counts the request against the client's address. It is registered before the guard, so a flood is counted before any token is verified | `registerRateLimit` | the same |
| 7 | Three hooks are registered that act on the way out: compression, `Cache-Control: no-store` on every `/api` reply but the health check, and the headers that say an answer is an old copy | `registerCompression`, `registerNoStore`, `registerStaleHeaders` | security and http, and [the core and the clients](server-core-and-clients.md) |
| 8 | The public health routes and the error handler are registered. Both are before the guard | `registerHealth`, `registerErrorHandler` | security and http |
| 9 | The guard looks at the route. A public route passes. For any other it finds the token in the `Authorization` header or the session cookie, never the query string, looks the user up again, and compares the user's role with the one `requiredRole` names. No session is a 401, and a role that is too low is a 403 that names both roles | `setupAuth`, `ROUTE_RULES`, `requiredRole` in `server/src/security/auth.ts` | security and http |
| 10 | A cookie POST also has to carry the custom header and an origin that matches, which a page on another site cannot add | `csrfRefusal` | the same |
| 11 | The route checks what the caller sent: the query names are declared, ids must be digits, numbers are clamped. A bad value is a 400 with a plain message | `singleValues`, `requireId`, `intParam` | [Server: routes](server-routes.md) |
| 12 | The route calls a service, `hostsOverviewView`. The service asks the cache for the key `hosts:overview` | `server/src/services/hosts.ts`, `cached` in `server/src/core/cache.ts` | [domain and hosts](server-domain-and-hosts.md), and the core and the clients |
| 13 | A fresh entry is returned at once. An entry past its life but inside its stale window is returned at once and one refresh starts in the background. With no entry, the fetch runs, and callers that arrive meanwhile wait for that same fetch | `cached` | the core and the clients |
| 14 | The fetch asks Zabbix: `host.get` for the hosts, the shared problem list, and the ping readings, all at once. Each call is one JSON-RPC request with the read token, a timeout, and the certificate check | `zbx` in `server/src/clients/zabbix.ts` | the core and the clients |
| 15 | The service turns what Zabbix said into the answer: for each host its state from ping first, and its open problems by severity | `hostState`, `getHostOverview` | domain and hosts |
| 16 | The reply goes out. The hooks of step 7 act: the body is compressed if the browser accepts it, `no-store` is set, and, if the answer was an old copy kept because Zabbix failed, `X-Data-Stale` and `X-Data-Age-Seconds` say so | the `onSend` hooks | security and http |
| 17 | If anything failed on the way, the error handler gives it one public sentence, "The data source is not answering", with the request id to quote. The method, the setting to check and what Zabbix said go to the log only | `registerErrorHandler` | security and http |
| 18 | nginx writes one access line with `rid=` and the same id, and passes the answer to the browser | `web/nginx.conf` | nginx, Docker and TLS |

## What to take from it

Three things hold for every request, and they explain most of the code.

1. Order matters. A hook only reaches the routes registered after it, so `index.ts` registers the request id, the host check, the headers, CORS, the rate limit and the three outgoing hooks before any route, and the guard before the route modules.
2. Nothing reads Zabbix on its own. A route calls a service and a service calls `cached`, so a busy minute costs Zabbix one read of each view, whatever the number of screens.
3. A failure is one sentence for the reader and the whole detail in the log, joined by the request id. When someone says "I saw reference 5f2a", the line to look for is `docker logs <server container> | grep 5f2a`.
