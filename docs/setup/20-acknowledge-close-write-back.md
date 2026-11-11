# 20. Acknowledge / close write-back

[setup.md](../../setup.md) · previous: [§19](19-authentication-rbac.md) · next: [§21](21-alert-noise-flapping.md)

The portal's only write. Everything else in this BFF is read-only by design
(build brief `myown/documents/plan/instruct.md` §0 rule 2; recorded as
[ADR-0006](../architecture/adr/0006-read-only-with-one-write.md)), so this route is fenced
deliberately rather than bolted on.

## Four independent fences

| # | Fence | Effect |
|---|---|---|
| 1 | A separate `ZABBIX_WRITE_TOKEN` | The read token never gains write power. If it did, *every* read path in the BFF would silently be able to modify Zabbix: one bug away from a write. |
| 2 | `operator` role or above | Enforced in [`auth.ts`](../../server/src/security/auth.ts) `ROUTE_RULES`; a viewer gets a 403 that names the role it needs. |
| 3 | Blank token ⇒ 503 | With no write token the portal is *strictly* read-only, and the UI hides the button rather than offering one that fails. |
| 4 | Sign-in on | With `AUTH_ENABLED=false` every caller would count as admin, so a write is refused with a 503 unless `ALLOW_WRITE_WITHOUT_AUTH=true`, which is for development only. |

[`zabbix.ts`](../../server/src/clients/zabbix.ts) keeps this honest at the transport layer: `zbx()` and
`zbxWrite()` are separate exports over one private `call()`, each bound to its own token. There is
no code path that writes with the read credential.

## One Zabbix method, a bitmask

Both actions go through `event.acknowledge`. The bits used:

| Bit | Meaning |
|---|---|
| `1` | close problem |
| `2` | acknowledge |
| `4` | add message |

So an acknowledgement with a note sends `action: 6`, and a close sends `1`. Verified against live
Zabbix: the event came back `acknowledged = 1` carrying the note.

## Closing needs the trigger's permission

Zabbix only allows a manual close when the trigger sets `manual_close`. Rather than offer a button
that Zabbix would reject, `getProblems()` carries a `manualClose` flag, read from the existing
`trigger.get` call so it costs no extra request, and the dialog disables the Close checkbox with
the reason shown.

## Caches must be dropped, not waited out

Problem state is cached for 15 s, and several other views derive from it. Without invalidation an
acknowledgement wouldn't appear until the TTL expired and the click would look like it did nothing.
After a successful write the route calls `invalidate()` on `problems`, `stats`, `probsByGroup`,
`sites`, `aging`, `services`, `hosts:overview`, `devices`, every `map:` detail and the assistant's `chat:snapshot`
(`STALE_AFTER_WRITE` in `services/actions.ts`). Those keys then stay on a short TTL for 15 seconds
(`WRITE_HOLD_MS`), because Zabbix applies a close a few seconds after `event.acknowledge` returns, and the
new list is pushed to every open stream. Measured: the very next `GET /api/problems` already showed
`acknowledged = 1`.

## On the page

Problems grows an Ack button (open problems only, and only when both fences 1 and 2 pass). It
opens a confirmation dialog: optional message, an Acknowledge checkbox, and a Close checkbox that
is disabled with an explanation when the trigger forbids it. The footer says *"This writes to
Zabbix"*, because a single click changing upstream state should never be a surprise. Errors from
Zabbix are put in the portal's own words, never as Zabbix wrote them: when Zabbix answers with an error, the dialog says *Zabbix refused the change. It may already be closed, or this account may not be allowed to change it.* and a reference that finds the line in the log, where Zabbix's own words stay (BK-43). When Zabbix does not answer in time it says the change may or may not have been made. When the web server answers instead of the portal, or the connection drops, it says *The portal did not answer (HTTP 502)* or *could not be reached*, with the same warning (FR-32). While a request is out, Confirm, Cancel, the cross, Escape and a click outside the dialog are all off (FR-33).

```bash
curl -X POST localhost:4000/api/problems/acknowledge \
  -H 'Content-Type: application/json' \
  -d '{"eventids":["26"],"message":"On it","acknowledge":true}'
# With sign-in on this needs a session cookie (a 401 without) and the CSRF header x-hcml-csrf. Then: 503 until ZABBIX_WRITE_TOKEN is set; 403 for a viewer
```

Not yet: bulk acknowledge across a selection, and severity change (`action` bit `8`). Both are
small extensions of the same route.


## What changed on 7 October 2026 (SC-07, SC-08, IN-06)

- The portal user goes into the message. The text Zabbix receives always starts with `[portal:<user>]`, also when the caller wrote nothing, because Zabbix files every write under the write token's owner. Brackets and control characters in the name are dropped, the tag comes first, and the cut at 2,048 characters keeps it.
- At most 50 event ids per request. A slip or a script cannot close a whole estate; the page sends one.
- Every attempt is on record. Each acknowledge or close writes a line with the user, the address, the event ids and the action, before any check can turn it away. A refusal or a failure writes a second line with the status.
- With sign-in off write-back is refused unless `ALLOW_WRITE_WITHOUT_AUTH=true` (§19), and `/api/health` then reports `writeBack: false`, so the buttons are not offered.
- The dialog warns when Zabbix is not collecting. If the freshness signal says Zabbix has collected nothing for over ten minutes, for example because no `zabbix-server` is running, the dialog says so before a change is sent: a close would be accepted and not applied.
- A close that does not apply says so. If the list still shows the problem open a minute after a close, the row reads "Close requested, not yet applied by Zabbix" and keeps reading it until the problem shows resolved. An acknowledgement that does not show is dropped from the row, as before.
