# 7. Live updates (SSE)

[setup.md](../../setup.md) · previous: [§6](06-frontend-structure.md) · next: [§8](08-authentication.md)

Server-Sent Events are the simplest live-push transport (chosen over WebSocket in the build brief,
`myown/documents/plan/instruct.md` §2; recorded as [ADR-0002](../architecture/adr/0002-react-typescript-fastify.md)).

- BFF: [`routes/stream.ts`](../../server/src/routes/stream.ts) opens an `text/event-stream`, and [`services/stream.ts`](../../server/src/services/stream.ts) pushes an
  `event: problems` frame when something shown changed, from one shared 15 s ticker, the pace the list is cached. A list identical
  to the last one sent is never sent again, and one where only a name or host changed goes after at
  most 30 s. A frame carries only the fields the Dashboard reads (`eventid`, `objectid`, `object`, `name`, `severity`, `clock`,
  `r_eventid`, `acknowledged`, `suppressed`, `host`, `hostid`): no tags, no `opdata`, and none of the other fields Zabbix
  returns, which is about half the size of the full list (tracker IN-11). A screen that accepts gzip (a browser does, over plain HTTP) gets the frames compressed by the BFF itself, `Content-Encoding: gzip`, with a sync flush after every frame and keep-alive so that none waits in a buffer: on HCML's list the first frame is 166,741 bytes, 18,693 on the wire. nginx's own gzip is off for `/bff` (`bff-proxy.inc`), so it passes the bytes on untouched. After 15 s of
  silence it sends an `event: ping` whose data is `{ "ageMs": n }`, the age of the last good read of
  the list, so the page's "Data as of" keeps moving on a quiet estate. It drops the client on
  disconnect. `X-Accel-Buffering: no` tells nginx to stream, not buffer.
- Limits. At most `STREAM_MAX_CLIENTS` screens in all (default 100) and `STREAM_MAX_PER_USER` for
  one signed-in user (default 5; one client address when auth is off). A screen past either limit
  gets `429 too_many_streams` with `Retry-After: 30`. The browser cannot read that body, so it falls
  back to the 60 s poll and retries. A stream is also ended when the token it was opened with
  expires, so the browser reconnects with the renewed cookie, and when the BFF shuts down.
- Browser: [`useSSE`](../../web/src/shared/hooks/useSSE.ts) wraps `EventSource`, for two pages. The Dashboard shows the stream's list. The Problems page keeps its 30 s poll and uses the stream as a signal: when a frame says a problem opened, resolved, was acknowledged, went into maintenance or was re-graded (`features/problems/liveChange.ts`), it reads the full list at once, because the frames leave out the tags and the live value it also shows. A Problems tab holds a stream slot, which `STREAM_MAX_PER_USER` counts. `EventSource` can't set headers,
  but it sends the session cookie on a same-origin request like any other, so the stream is
  authenticated by cookie. No route accepts a token in the query string.
