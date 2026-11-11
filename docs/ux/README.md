# Who uses this, and how

> **Derived, not interviewed. Confidence: low.**
>
> Nobody has been interviewed, no session has been recorded, and there is no analytics in the
> portal. Everything below is read out of the code, the Zabbix estate and `DESIGN.md`, and every
> claim cites where it came from. Treat it as a description of what the software permits and expects,
> which is a weaker thing than a description of what people do.
>
> The honest version of a persona needs 20+ users and two data sources. This has neither. It is
> written down because a wrong model that is visible can be corrected, and an unwritten one cannot.
> The first real interview should replace, not supplement, this page.

## What is actually known

| Fact | Source |
|---|---|
| Four roles, ranked: viewer, wall, operator, admin | `server/src/security/auth.ts` `ROUTE_RULES` |
| An unmatched route needs `viewer`, so a new route is private by default | `security/auth.ts:48` |
| Only `/api/reports/inventory`, `/api/sli/email` and `/api/sli/schedule` need admin | `security/auth.ts:39` and `:41` |
| `/api/links` and `/api/net` (the Dashboard's internet traffic meters, `/api/net/meters`, among them) need wall, which an operator and an admin pass too | `security/auth.ts:42` |
| Only the write route (acknowledge, with close as an option) needs operator, so a wall screen never writes | `security/auth.ts:44` |
| 19 pages, 18 of them behind the shell | `web/src/App.tsx` |
| 139 monitored hosts across 14 sites | Zabbix, measured 15 September 2026 |
| Exactly one write exists: acknowledge and close | `server/src/routes/actions.ts` |
| That write is off unless `ZABBIX_WRITE_TOKEN` is set, and returns 503 otherwise | `routes/actions.ts:39-51` |
| The Dashboard holds one long-lived SSE connection, exempt from the rate limiter and capped on its own (100 screens in all, 5 per user) | `server/src/http/rateLimit.ts:6,26`, `services/stream.ts` |
| Nothing the portal derives is stored anywhere | ADR-0003, ADR-0004 |

Everything after this point is inference from those facts.

## Four roles, four different relationships with the screen

The roles are not seniority levels. They are four different reasons to open the portal, and the
route rules draw the lines in a way that says what each one is for.

### Viewer

Has: every page except Network, Links & WAN health, and the Inventory & ownership scorecard.

Cannot: reach anything that writes, because the write route requires operator.

What the permission set implies: a viewer is trusted with the whole estate's state and with none of
its actions, including the read-only WAN topology. That is an unusual line to draw, and it is
informative. Network and Links expose which physical links exist between sites, which is closer to
infrastructure documentation than to monitoring. A viewer is someone who needs to know whether
things are working, not how they are wired.

The screens this implies matter most: Dashboard, Problems, SLA, Availability. Three of the four
answer a question someone else asked them.

### Wall

Has: everything a viewer has, plus Network, Links and WAN, and the Dashboard's internet traffic
meters, to read only.

This is not a person. It is the account of a NOC screen that turns between the Overview and the
meters (`/?wall=1`), and the meters are interface data. A screen anyone can walk up to must never be
able to acknowledge or close, so the wall stops one rank below operator (tracker MT-06).

### Operator

Has: everything a wall screen has, plus acknowledge and close.

This is the only role that can change anything, and what it can change is one thing. The portal is
read-only except for a single write (ADR-0006), and that write is what an operator is for.

The one job the software is shaped around: see a problem, understand it, acknowledge it. The
journey map below is this, and it is the only flow that can be traced end to end in code, because it
is the only one that ends in an action rather than in a reader's head.

A constraint on the design: `WRITE_HOLD_MS` is 15 seconds (`services/actions.ts`). Zabbix applies
a close a few seconds after `event.acknowledge` returns, so the first refetch can still show the
problem as open. The interface has to be honest about that window rather than pretend the write was
instant.

### Admin

Has: everything, plus the Inventory and ownership scorecard.

One page, and it is not about the estate's health. It is about whether the estate's *records* are
complete: which hosts are missing an owner, a site, an inventory field. That is a management view,
not an operations one, and it is the only page whose subject is the monitoring system rather than
the network.

## The NOC wall is a fourth context, not a fourth role

`DESIGN.md` section 5 names it: the Dashboard doubles as a wall display, and `/api/stream` is exempt
from the rate limiter specifically so a wall poller does not throttle itself
(`server/src/http/rateLimit.ts:6,26`). It is capped instead, at 100 screens in all and 5 for one signed-in
user, so a wall of more than five screens on one shared login needs `STREAM_MAX_PER_USER` raised.

This is a real, code-backed usage context with no user attached. Nobody is signed in as "the wall".
It reads as a viewer, it never clicks, and it is looked at from several metres away by people doing
something else. Three consequences, all of which are now in the interface:

- The sidebar starts collapsed on `/` only, because nav labels are not what anyone reads from across
  a room (`useUiPrefs.ts`).
- Motion on that page is signal. A problem appearing or clearing must be visible peripherally. Since
  26 October 2026 the rest of the portal moves a little (MOTION 2, DESIGN.md section 10), and wall mode
  turns that off, so the highlight of a problem stays the only motion on the wall.
- Severity is the only loud colour anywhere, which is what makes a red chip readable at distance
  when everything else is one blue.
- A wall that is to turn to the internet meters has to be signed in as an operator or an admin: the
  meters are interface data, which a viewer does not get (`viewerPolicy.ts`). A wall signed in as a viewer
  turns between the Overview and the Hosts, which are not interface data, and asks for nothing more. An operator's session on a screen nobody watches is
  an operator's session, so the wall's account should be one made for it, and the write token (which is
  what lets an operator acknowledge) should stay off, as it is now.

## Journey: a problem gets acknowledged

The only journey traceable end to end in code. Every step names the file that performs it.

| Stage | What happens | Where | What can go wrong |
|---|---|---|---|
| Notice | The Dashboard's SSE connection pushes a `problems` event; the count and the list change without a reload | `services/stream.ts`, `shared/hooks/useSSE.ts` | The connection drops. Until 24 September 2026 that was silent: the page kept showing the last good state with no indication it had stopped being live (friction point 1) |
| Orient | Operator reads severity, host, duration. Severity is a filled chip, which is the only loud colour on the page | `ProblemsTable.tsx`, `shared/lib/severity.ts` | Host names are Zabbix's, which are not always the names people use for the same box |
| Understand | Optional: open Explain, which sends the problem to the model and returns plain language, cached an hour | `services/explain.ts` | Off by default. When off, the operator is reading a trigger expression |
| Decide | Operator decides this is known or being handled | none | Nothing records that a decision was made, only that an acknowledgement was sent |
| Act | Acknowledge, with a message, optionally closing | `AckDialog.tsx` → `POST /api/problems/acknowledge` | Returns 503 if `ZABBIX_WRITE_TOKEN` is unset. The UI hides the control in that case, so the operator's route to acting is simply absent rather than explained |
| Confirm | Affected cache keys are dropped and, for 15 s, refetched on a TTL of at most 2 s, then the SSE push carries the new state | `services/actions.ts` `WRITE_HOLD_MS` | For up to 15 seconds the problem can still read as open. Acting twice is the obvious failure |

Where the friction is, in order of how much it costs:

1. **A dropped SSE connection looks exactly like a quiet network.** On a page whose entire purpose is
   noticing, the worst failure is one that looks like good news. This is the highest-value thing on
   this page and it is not solved by tokens or contrast. *Addressed 24 September 2026:* the Dashboard
   now shows *Updated HH:MM:SS* beside its live badge and turns the badge to a warning after 90 s
   without new data, and the stream reopens on its own after an error, backing off from 2 s to 60 s.
   A Zabbix that has stopped collecting is a second form of the same failure, since the stream stays
   up and keeps sending old values. *Addressed 7 October 2026:* the Dashboard shows "Zabbix has
   collected nothing since …" and the badge turns to the same warning (`GET /api/freshness`).
2. **The 15-second write window is invisible.** The operator has no way to tell "already
   acknowledged, waiting for Zabbix" from "the click did nothing". *Addressed 7 October 2026:* a row
   says "Sent, waiting for Zabbix" until the refreshed list shows the change, and the list is read
   every 3 s meanwhile. After a minute with no change the row offers Ack again; a close that the list still shows open keeps a note, "Close requested, not yet applied by Zabbix", until the problem shows resolved.
3. **Write-back being off removes the control rather than explaining it.** Correct for a viewer, and
   confusing for an operator who has acknowledged from this screen before. *Addressed 7 October 2026:*
   an operator sees "Acknowledge is off on this portal. Ask the portal admin to turn it on." once the
   server has said write-back is off.

None of the three is a visual problem. The pass this document was written alongside fixed contrast,
tokens, focus and dark mode, and fixed none of these. The three
fixes above are wording and state, and add no colour, layout or component.

## What would actually settle this

In the order that would tell you the most per hour spent:

1. Watch one operator for one shift. Not a usability test, just presence. The list above predicts
   what is hard; an afternoon would confirm or destroy it.
2. Ask three people to name the page they open first and why. The answer distinguishes a portal
   used for triage from one used for reporting, and the two want different Dashboards.
3. Count how often acknowledge is used. If it is rare, the write is not what the operator role is
   for, and this whole document has the wrong centre.
