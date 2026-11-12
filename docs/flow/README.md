# Flow: HCML Monitoring Portal (`hcml-portal-ollama`)

Three views of the same system in motion. `schema/` answers *what the data is*; this folder answers
*what happens*. Use the PDFs; the `.mmd` files beside them are the source.

| File | Question it answers | Shape |
|---|---|---|
| [`WebFlow.pdf`](WebFlow.pdf) | What happens in the browser, from the first byte to data on screen? | 6 stages, 27 boxes |
| [`ServerFlow.pdf`](ServerFlow.pdf) | What happens to one request inside the BFF, in the order it runs? | sequence, 7 participants |
| [`DataFlow.pdf`](DataFlow.pdf) | Where does a number come from, and where does it go? | 5 lanes, end to end |

Read them in that order if you are new: the browser is what you can see, the server is what it talks
to, and the data flow is the whole path.

---

## The nine flows, one line each

The PDFs are the detail. These are the same flows in a form you can read in a terminal, paste into a
message, and see change in a diff. Every line comes from the source file cited beneath it, not
from the prose further down this page: that prose is what drifted last time.

### 0 · The whole system

```text
Browser (React)  ──HTTP+SSE──►  BFF (Fastify, holds tokens, caches)  ──JSON-RPC──►  Zabbix API
```

The first arrow is plain HTTP on this computer's loopback address: nginx listens on port 8080 inside
its container and Docker publishes it on `127.0.0.1` only. Nothing in this repository terminates
TLS, so before the portal is reached from another machine, put TLS in front of it:
[`../operations/tls.md`](../operations/tls.md).

Behind that third box is Zabbix's own MySQL. **The portal never reaches it**: no driver, no
connection string, no network route. Everything the portal adds is computed between boxes two and
three and thrown away. [ADR-0003](../architecture/adr/0003-no-database.md),
[ADR-0007](../architecture/adr/0007-keep-the-zabbix-api.md).

### 1 · Web: a page load

```text
index.html ──► main.tsx ──► <App/> ──► GET /api/auth/me ──► route match ──lazy chunk──► useAsync ──► fetch /api/… ──► table / ECharts
```

Every page is code-split. `useAsync` lets only its newest run write state, so picking host A and
then host B cannot leave A's slower answer on screen. A 401 from anywhere sends the API client
(`web/src/api/`) to `/login`, and so do a sign-out in another tab and a page Back restores after one;
those are the only automatic paths to it, because nothing guards routes by role in the browser. The
sidebar's role filter is cosmetic; the BFF returns 403 regardless. `web/src/App.tsx:40-69`.

### 2 · Web: the live dashboard

```text
Dashboard ──EventSource /api/stream + session cookie──► BFF ──tick 15 s──► Zabbix ──event: problems──► setState
```

`useSSE` has two call sites, `Overview.tsx` and `Problems.tsx`; navigating away closes the connection. The Dashboard shows the stream's list; the
Problems page keeps polling every 30 s and reads its list again at once when a frame says the list changed. The server ticks every 15 s, the pace the list is cached, but only writes when the fingerprint changed
(a change in only a name or host waits up to 30 s, a list identical to the last one is never
resent, and a frame carries only the fields the Dashboard reads: no tags, no `opdata`), and a screen that accepts gzip gets the frames compressed, flushed after each one. After 15 s of silence it sends a named `ping` event that carries the list's age in
milliseconds: `useSSE` uses it to tell a quiet line from a dead one and to keep "Data as of" moving.
Screens are capped (`STREAM_MAX_CLIENTS` 100 in all, `STREAM_MAX_PER_USER` 5, a 429 past either), a
signed-in stream ends when its token expires so the browser reconnects with the renewed cookie, and every
stream ends on SIGTERM so the server can close. No token rides in the URL: `EventSource` cannot set a header, but it sends the
httpOnly session cookie like any same-origin request, and the BFF refuses `?token=` on every route.
`logging.ts` still redacts one, for pages loaded before the cookie (ADR-0010).
`server/src/services/stream.ts:27-36,303-322`, `server/src/routes/stream.ts:4-39`, `web/src/api/problems.ts:7-10`.

### 3 · Server: one request

```text
request ──► helmet ──► CORS ──► rate limit ──► compression ──► no-store ──► stale headers ──► error handler ──► auth guard ──► route ──► cached() ──► zabbix.ts ──► JSON
```

That is `index.ts` registration order, and **the order is the design**: a Fastify hook only covers the
routes registered after it. The rate limit sits ahead of the auth guard deliberately: a flood should
be rejected before the server spends work verifying JWTs, and `POST /api/auth/login` would otherwise
be an unthrottled password oracle. `server/src/index.ts:56-106`, `server/src/http/rateLimit.ts:22-35`.

### 4 · Server: the cache

```text
cached(key, ttl, fn) ──► fresh hit │ join in-flight │ stale-while-revalidate │ miss ──► Zabbix
```

Four *outcomes*, not four checks: "already fetching" and "miss" are the same line of code,
`inflight.get(key) ?? begin(key, fn, opts.pin)`. 500 entries or about 64 MB of values, whichever is
reached first, TTLs from 15 s to 24 h, all of it gone on restart. A closed month's SLA report is pinned,
so a run of graph keys cannot push it out.
This is why twenty NOC screens cost one upstream read. Stale serving is never permitted for the problem
list. A view HCML's Zabbix takes tens of seconds to build is answered from its last copy while a newer one
is read, and says so in `X-Data-Refreshing`; an answer given from an old copy because Zabbix failed says so
in `X-Data-Stale`; both carry `X-Data-Age-Seconds`. `server/src/core/cache.ts:87-216`.

### 5 · Auth

```text
POST /api/auth/login ──► JWT, 12 h by default, in an httpOnly cookie ──cookie │ Authorization: Bearer (scripts)──► onRequest: forgery check, then guard ──ROUTE_RULES──► 200 │ 401 │ 403
```

Users come from the environment, not a table: `PORTAL_USERS` as `name:password:role` triples, or
`PORTAL_USER`/`PORTAL_PASS` as the single-admin shorthand. Four rules set the roles above the default:
admin for `/api/reports/inventory`, `/api/sli/email` and `/api/sli/schedule`, wall for `/api/links` and `/api/net`, and operator for the acknowledge
write, and anything unmatched needs viewer, so a new route is protected by default rather than
accidentally public. `/api/health`, `/api/auth/login`, `/api/auth/me` and `/api/auth/logout` are the
only exemptions, matched exactly against the route the router matched, so an encoded path such as
`/%61pi/hosts` is guarded like `/api/hosts`. Sign-in allows 10 attempts a minute per account and
address. The forgery check runs first: a POST sent with the cookie, and every sign-in and sign-out,
needs `X-HCML-CSRF: 1` and, when the browser sends an `Origin`, one naming the portal's own host and
port, or gets 403 `csrf`. A Bearer request skips the check, except on sign-in and sign-out. `POST /api/auth/logout` clears the cookie.
In `server/src/security/auth.ts`: `ROUTE_RULES` 36-41, `roleAllows` 47, `PUBLIC_ROUTES` 50, `csrfRefusal` 133,
`loadUsers` 177, `authenticate` 308, and the `onRequest` guard from 476.

### 6 · Data: where a number comes from

```text
device ──ICMP/SNMP──► Zabbix poller ──► MySQL history + trends ──JSON-RPC──► BFF derives site · link · incident · SLA ──► browser
```

Follow any number backwards from the screen and you arrive at Zabbix's MySQL, except the derived
ones, which stop at the BFF. Sites, links, incidents, host availability and the monthly SLA have no
table anywhere ([ADR-0004](../architecture/adr/0004-derive-the-sla-in-the-portal.md)). Note also that
box two has been switched off since **17 September 2026, 16:59:37**: local polling was stopped
deliberately, so every figure downstream is a snapshot of that moment
([ADR-0008](../architecture/adr/0008-stop-local-polling.md)).

### 7 · AI: Explain

```text
ExplainPanel ──GET /api/explain/problem──► ai.ts ──HTTP──► 127.0.0.1:11434 (qwen3:8b) ──► buffered JSON, cached 1 h
                                                    stays on this host
```

Reached on demand only, never on page load, and only if the layer is configured at all. One
problem is sent to the local model: host, trigger name, opdata, severity, start time, the
acknowledged/resolved flags and that problem's tags, and none of it leaves this host.
`/api/explain/sla` is the second route on this path and is cached 5 minutes, not an hour.
`server/src/routes/explain.ts:11`, `server/src/services/explain.ts:80,120`.

### 8 · AI: the Assistant

```text
Assistant ──POST /api/chat──► estate snapshot + ≤3,000 chars of history ──► model ──SSE: context → token… → done──► parseMarkdown.ts
```

The Assistant is the larger of the two AI paths by a wide margin: Explain sends one problem, this
sends a rollup of the whole estate: all 139 hosts by site, the open problems, unreachable-host lists
and derived SLA figures. Streamed token by token and never cached, where Explain is buffered and
cached. `HISTORY_CHAR_BUDGET` is the one hard cap in the prompt, at 3,000 characters.
`server/src/services/chat.ts:31-32`, `server/src/routes/chat.ts:27`.

### 9 · The one write

```text
Acknowledge ──POST /api/problems/acknowledge──► operator role + ZABBIX_WRITE_TOKEN ──► event.acknowledge ──► cache invalidate ──► SSE push
```

The portal's only write to Zabbix, behind a token separate from the read token. Leave `ZABBIX_WRITE_TOKEN`
unset and the portal sends no write, provided the read token's role is read-only (tracker SC-23):
`/api/health` reports `writeBack: false` and the UI hides the control. The invalidate and the push are drawn as a parallel fork in `DataFlow` but run in
sequence: `event.acknowledge` is awaited first.
[ADR-0006](../architecture/adr/0006-read-only-with-one-write.md), `server/src/routes/actions.ts:39`.

---

## What this copy's perspective is

This is `hcml-portal-ollama`: the plain-language layer is `qwen3:8b`, served by Ollama on this
host. So in `DataFlow` the model box is green like everything else the portal computes, and the
box beside it reads *STAYS ON THIS MACHINE*.

**There is no red anywhere in this folder**: verified, not asserted: the rendered `DataFlow` here
carries 0 red fills and 9 green. The sibling repo `hcml-portal` renders the same diagram with
3 red: two because the model there is hosted Claude over the Anthropic API and a problem's host name,
trigger name and tags cross the network when someone clicks *Explain*, and one for the report by
email, which this copy never sends.

`WebFlow.mmd` and `ServerFlow.mmd` are byte-identical in both repos. Verify with `diff`, not by
eye. The browser and the request pipeline do not know or care which model answers.
Inside this folder only `DataFlow.mmd`, `DataFlow.pdf` and this README differ. `DataFlow` differs in
the `MODEL` box, the `LEAVES` box, the `class` lines that colour them, and lane 6 (the report by
email and its state file), which only `hcml-portal` has. (Outside this folder
the repos also differ in `README.md`, `AUDIT_REPORT.md`, `docker-compose.yml`, the `.env` files and
the `schema/` diagrams, so "the repos differ only in
DataFlow" is true of *this folder*, not of the whole tree.)

> The green box says the *estate
> data* stops here. It does not say the portal is offline: it still reaches Zabbix, and the claim
> rests on `AI_PROVIDER=openai-compatible` with `AI_BASE_URL` pointing at this host.
>
> Both halves matter, and the switch fails quietly. `config.ai.enabled` for this provider means
> "a base URL is present", so setting `AI_PROVIDER` *without* `AI_BASE_URL` 503s the feature and
> hides the buttons, with only a warning in the startup log. Worse, `AI_PROVIDER` accepts only
> `anthropic` or `openai-compatible` and **falls back to `anthropic` for anything else**: a typo such
> as `AI_PROVIDER=ollama` or `=local` turns this diagram back into the red one with no code change,
> no error, a startup warning as the only sign, and no visible difference in the UI. An empty
> `AI_PROVIDER` falls back with no warning at all. Going the other way, back to hosted, also needs `AI_MODEL` dropped, or
> `qwen3:8b` is sent to the Anthropic API and every *Explain* fails.
>
> Since 24 September 2026 the Docker deployment cannot make that mistake. This copy's
> `docker-compose.yml` fixes `AI_PROVIDER` to `openai-compatible` instead of reading it from `.env`,
> defaults `AI_BASE_URL` to `http://host.docker.internal:11434/v1`, and passes no Anthropic key to
> the container. The fallback above still applies under `npm run dev`, where `config.ts` reads
> `AI_PROVIDER` itself; this copy's `.env` files carry no Anthropic key, so there it turns the AI
> off rather than sending anything out.

---

## How to read each one

**WebFlow: a flowchart, six numbered stages.** Boot → who is this → a page asks for data → the live
stream → the on-demand extras → what happens when it fails. Amber is code running in the browser;
the single green box is the BFF, where this diagram hands over to `ServerFlow`; grey boxes are
decisions and guards rather than components.

Six things on it are easy to miss and cost real bugs if you forget them:

- `useAsync` lets only its newest run write state. Pick host A, then host B, and A's slower answer
  must not land last and stay on screen.
- Polls are sequential, not on a fixed timer: the next is scheduled once the last settles, so a
  slow BFF is never asked twice at once.
- No token rides in the stream's URL. `EventSource` cannot set a header, but it sends the
  httpOnly session cookie like any same-origin request, so the BFF refuses `?token=` everywhere.
  `logging.ts` still redacts one, for pages loaded before the cookie.
- Two pages stream. `useSSE` has two call sites (`Overview.tsx` and `Problems.tsx`), and navigating
  away closes the connection. The Problems page uses the stream only as a signal to read its list again; it still polls every 30 s.
- `ExplainPanel` does not render markdown. It writes its fields as plain `<p>` paragraphs; the
  Assistant is the only consumer of `features/assistant/parseMarkdown.ts`.
- Stage 2's "signed in?" diamond is not a route guard. Nothing reads the role and redirects: the
  automatic paths to `/login` are the API client reacting to a 401, to a sign-out in another tab, or to a
  page Back restores after one, so an unauthenticated visitor sees
  the chrome painted for one round trip before the redirect lands. The sidebar's role filter is
  cosmetic; the BFF enforces with a 403 regardless.

**ServerFlow: a sequence diagram.** Read strictly top to bottom, because the order is the design. A
Fastify hook only covers the routes registered after it, so `index.ts` registers helmet, CORS, the
rate limit, compression, the error handler and the auth guard *before* any route module. The rate
limit sits ahead of the auth guard deliberately: a flood should be rejected before the server spends
work verifying JWTs, and `POST /api/auth/login` is otherwise an unthrottled password oracle.

The `alt` blocks are the four cache outcomes, and they are the reason twenty NOC screens cost one
upstream read: fresh, coalesced, stale-while-revalidate, or a genuine miss. Read them as four
*outcomes*, not four checks: "already fetching" and "miss" are the same line of code
(`inflight.get(key) ?? begin(key, fn)`), drawn apart because the cost differs so much. Note too that
the stale-while-revalidate lane cannot fire on the `/api/sites` request being traced: `staleMs`
is 0 there, and stale serving is never permitted for anything showing problem or acknowledgement
state. It applies to the slow reports only.

Two numbers in the red band are deliberate and easy to "fix" wrongly: a rejected token and an
unresponsive Zabbix both return 503, not 502/504, because they are *configuration* states rather
than upstream faults, and nothing in the server ever returns 504. Both are pinned by tests. Only
`zabbix_error` is a 502.

**DataFlow: five lanes, top to bottom, each read left to right.** Lane 1 is Zabbix doing the work we
do not do. Lane 2 is the BFF. Lane 3 is the plain-language layer, reached on demand only, never
on page load. Lane 4 is the browser. Lane 5 is the single write to Zabbix. There is no lane 6 in this
copy: the hosted copy's report by email needs `MAIL_` settings and a state volume, and this one passes
and declares neither.

Lane 5 ends in its own terminal box rather than an arrow looping back to lane 1. It is the same
Zabbix API; the arrow is omitted because one cycle is enough to make the layout engine scramble the
reading order of every other lane. Lane 5's two leaves are drawn as a parallel fork but run in
sequence: `event.acknowledge` is awaited first, and only then does the invalidate + push run.

Two things lane 3 is easy to misread. The answer box describes two different features and neither
has both properties: *Explain* is cached 1 h per problem-and-state and returns one buffered JSON
reply, while the *Assistant* is streamed token by token and is never cached. And the arrow into the
snapshot carries no tags: the chat snapshot emits severity, host, trigger name, opdata, age and
ack state; tags cross on the per-problem Explain path alone. When editing the source, note the
subgraph IDs do not match the lane numbers: lane 3 is `D4` and lane 4 is `D3`. Go by the titles.

What lane 3 costs here, measured on 18 September against a real question:

| | |
|---|---|
| First token, cold model | 9.7 s, Ollama idle past `keep_alive`, so this includes the ~8 s load |
| First token, warm | 0.5 to 1.9 s |
| Whole answer | 13.9 s, 69 token frames |
| Resident while loaded | ~5 GB, for 30 min after the last question |

Those are the numbers the green box buys. The hosted copy was faster in the same test; this
one does not send anything anywhere.

### Colours, in all three

| Colour | Meaning |
|---|---|
| Blue | Zabbix owns it and stores it |
| Green | The portal derives it, on this machine. No table exists: built per request, cached for seconds, gone on restart |
| Amber | Runs in the browser |
| Purple | The portal's single write back to Zabbix |
| Red | It leaves this machine: none in this copy |
| Grey | A decision, a guard, or a boundary |

The same palette as [`../schema/`](../schema/), so a box means the same thing in both folders.

**One exception:** `ServerFlow`'s six `rect` bands are *phase*
bands, and two of them reuse a colour from this table with a different meaning. Its amber band is
the `onRequest` forgery check and auth guard running inside the BFF, not browser code. Its red band is
"when Zabbix does not cooperate": an upstream failure, and nothing leaves the machine there. Grey
(guard), green (derived) and purple (the one write) do match the table. The sixth band, slate, is the report by email. In this copy there is no red
anywhere on `DataFlow` at all.

---

## Where the numbers stop

Follow any number backwards from the screen and you arrive at Zabbix's MySQL, except for the
green boxes, which stop at the BFF. Sites, links, incidents, host state and the monthly SLA have no
table anywhere: they are computed per request, cached for seconds, and gone when the container
restarts.

In this copy that is true of the *explanations* as well. Every green box on `DataFlow`, including the
model, is something this machine produces and nothing else holds a copy of.

---

## Regenerating

From inside this folder, after editing a `.mmd`:

```bash
npx @mermaid-js/mermaid-cli -i WebFlow.mmd    -o WebFlow.pdf    -w 2600 -b white --pdfFit
npx @mermaid-js/mermaid-cli -i ServerFlow.mmd -o ServerFlow.pdf -w 2600 -b white --pdfFit
npx @mermaid-js/mermaid-cli -i DataFlow.mmd   -o DataFlow.pdf   -w 2600 -b white --pdfFit
```

`--pdfFit` sizes the page to the chart; without it the diagram is squeezed onto A4 and unreadable.
For a raster copy to paste into slides, swap the output for `.png` and add `-s 2`.

Four rules these sources must keep:

- Every `subgraph` needs a `style <NAME> fill:none,stroke:#94a3b8` line. Mermaid paints cluster
  rectangles *after* the relationship lines, so a filled frame hides every edge beneath it.
- A comment line must start with `%%`. A bare `%%` with no text is a parse error in `erDiagram` and,
  worse, a silent node labelled `%%` in a `flowchart`. Separate comment paragraphs with a
  genuinely empty line.
- **`DataFlow` deliberately does not use `layout: elk`.** Its lanes need per-subgraph `direction`,
  and elk ignores that: with elk the whole chart flattens into a 6:1 strip. `WebFlow` has no inner
  directions and keeps elk.
- **Avoid numeric HTML entities** such as `&#9888;` in node labels; they render with a stray `&`
  in front. Named entities (`&middot;` `&hellip;` `&rArr;`) are fine.

**If you change `WebFlow.mmd` or `ServerFlow.mmd`, make the identical change in `hcml-portal`**: those
two are meant to stay byte-identical, and `diff` is the check. `DataFlow.mmd` and this README are
meant to differ; keep the rendered difference to the places named above (`MODEL`, `LEAVES`, their
`class` lines, and the hosted copy's lane 6).

Both folders are named `flow/`, lowercase, in both repos, so this check works on a case-sensitive
filesystem too. Use `cmp`, not `diff`: on a case-insensitive volume such as APFS a wrong-case
path still resolves, and on a case-sensitive one `diff` against a missing file prints an error that
is easy to mistake for success in a script.

```bash
cd ../../..                                  # myown/
cmp hcml-portal/docs/flow/WebFlow.mmd    hcml-portal-ollama/docs/flow/WebFlow.mmd    && echo "WebFlow OK"
cmp hcml-portal/docs/flow/ServerFlow.mmd hcml-portal-ollama/docs/flow/ServerFlow.mmd && echo "ServerFlow OK"
```

A quick way to prove this copy's claim after any edit:

```bash
npx @mermaid-js/mermaid-cli -i DataFlow.mmd -o /tmp/df.svg -w 2600 -b white
grep -o '#fee2e2' /tmp/df.svg | wc -l    # red: must be 0 here, and 3 in hcml-portal
grep -o '#dcfce7' /tmp/df.svg | wc -l    # green: must be 9 here, and 8 in hcml-portal
```

Then run `node tools/check/diagrams.stamp.mjs` from the repo root. It records which source each render was made from, and CI fails on a source edited after its stamp (`tools/check/diagrams.check.mjs`).

Use `grep -o … | wc -l`, not `grep -c`. Current Mermaid emits the class fills once in a `<style>`
block rather than inline on each node, so `grep -c` counts *lines* and reports 1 where the real
occurrence count is 2. Verified on 21 September: hosted rendered 2 red / 7 green and this copy 0 red /
9 green; the hosted copy renders 3 red / 8 green since lane 6, measured on 11 November.

---

## If you want more than these three

[`../../setup.md`](../../setup.md) walks every subsystem in prose, §1 is the big picture and §2 traces a
request end to end, which is the same ground as `ServerFlow` in words. [`../schema/`](../schema/) is
the same system at rest, CDM, ERD, PDM, and [`../erd/erd.md`](../erd/erd.md) is the exhaustive version of
that.
