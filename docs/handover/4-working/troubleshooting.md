# Troubleshooting

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Operators and developers | about 10 min | [Change recipes](change-recipes.md) | [The traps](traps.md) |

Start with three questions, in this order. Is the page wrong, the portal, or Zabbix? Which request failed? What does the log say about it? The table that follows is for the second look, once you know which of the three it is.

## Find the cause in four steps

1. Ask the portal itself. `curl -s http://127.0.0.1:8081/bff/api/health` (8082 for the local-model copy). No answer means the containers are down or Docker is: `docker compose ps` in the copy's folder, and Docker Desktop on a Mac. An answer with `ok: true` means the process runs, and `ready` says whether it can read Zabbix (a plain `true` or `false`; signed in, an object). When `ready.ok` is false, `ready.zabbix` says why (signed in only): `token_rejected` is a token that was revoked or has expired, `timeout` is Zabbix too slow, and `error` is an address or a network problem.
2. Take the reference from the error. Every error a person sees says "quote reference" and an id, a long string of letters and digits, which is copied whole. That id is the request id: nginx makes it, the server logs it as `reqId`, returns it in `X-Request-Id` and puts it in the error body. So `docker logs <server container> | grep <id>` finds the line, in the container of the portal where the error appeared. The address bar says which: port 8081 is `hcml-portal` and port 8082 is `hcml-portal-ollama`, and the containers are `<folder>-portal-bff-1` and `<folder>-portal-web-1`. The line that names the method, the setting to check and what Zabbix said.
3. Read the page's own notices. A banner at the top says whether the data is an old copy (`Zabbix did not answer, so this is the last copy the portal kept`), a copy being refreshed, a Zabbix that has stopped collecting, or a Zabbix that cannot reach the network. Those are not the portal's faults, and the time beside each says how old the figures are.
4. Ask the watcher. `deploy/watch.sh --status` shows its last state and the last lines of its log, which say when a portal last answered.

## Symptom, cause and what to do

| What you see | Likely cause | What to do |
|---|---|---|
| Every panel says "The data source is not answering" | The server cannot read Zabbix: the office network is down, the LAN mapping in `docker-compose.override.yml` is missing, the token was revoked, or Zabbix is down | `ready.zabbix` in the health answer, then the log line for the reference. From the host, try the token with `curl` as in [run it](run-it.md) |
| A page takes about a minute the first time and is quick after | HCML's Zabbix is slow on large reads. After a start the server reads its main views by itself, and the first visit to a page that is not among them waits for Zabbix | Wait. It is normal. The server's log says `warm-up: done` when the main views are ready |
| A page is slow every time | The copy it was waiting for is gone: a report is kept two minutes, and the slow views ten minutes after their last read | Look at the notice for an old copy, and at the log for `GET` timings. Do not raise a timeout until you know which read is slow |
| "Zabbix has collected nothing since 08:48" | `zabbix-server` at HCML has stopped, though the API still answers | Tell HCML IT. The figures on the page are from that time and not from now |
| "Zabbix cannot reach the network" | Almost no device answers ping at once: Zabbix has lost its way into the network | Tell HCML IT. The hosts it calls down and the problems it raises are most likely not real |
| A number differs from Zabbix's own screen | The portal's copy is up to 15 seconds old. The portal leaves a suppressed problem (raised inside maintenance) and a solved one that Zabbix still lists out of its counts. A filter is on in one of the two screens. The Dashboard's live list shows only the twelve worst | The time beside the badge, then both screens at the same moment. [Can I trust it](../0-everyone/can-i-trust-it.md) says the same in plain words |
| The Dashboard badge says "Polling", not "Live" | The live stream is blocked, silent for 45 seconds, or refused for too many screens (429) | A proxy in front of nginx must not buffer. Check the log for "live stream refused". The page polls meanwhile, so nothing is lost |
| There is no Explain button, and the Assistant says it has no model | AI is switched off, the key is missing or refused, or the local model is down | `ai` in the health answer. In `hcml-portal` the Anthropic key is a setting. In `hcml-portal-ollama` check that Ollama answers |
| There is no Acknowledge button | No `ZABBIX_WRITE_TOKEN`, sign-in is off, or the role is below operator | `writeBack` in the health answer and the signed-in role |
| There is no "Email report" button | Only an administrator sees it, and only when email is set up: the `MAIL_` settings are blank, or one of them cannot be used | The role, then the start-up log for a line that begins "Email is off", which names the setting and never holds the password. `GET /api/sli/email` says whether email is on |
| "Email report" says the mail server refused the login, could not be reached, did not answer or did not take the message | The login or the server in the settings is wrong, the Mac cannot reach the mail server, or the provider wants more than a name and a password: an app password for Gmail, Yahoo, Zoho and iCloud, and OAuth2, which is not built, for Microsoft accounts | The sentence names the setting to check. The server's own words are in the log, in the line "the mail server did not take the report", with the login and the password taken out. A 429 means five attempts in the current hour (a wrong password counts as one): wait |
| The "Schedule" dialog says the schedule cannot be used | Email is not set up, `MAIL_SCHEDULE=off` is set on this machine, or the portal has no data folder to keep a schedule in (`PORTAL_STATE_DIR`, the volume `portal-state`) | The dialog's first line says which, in words. For the folder: `docker compose config` shows the volume, and the BFF log has a line about its data folder if it could not write there |
| The monthly report did not arrive on the first | The portal was off or asleep, or off HCML's network (it then sends when it can, for up to a week), or the mail account refused the login, or the schedule is off, or the day or time was changed after the slot (a slot that came before the change is never sent late) | The Schedule dialog: the status line and the last sends, with a word for why each failed. The BFF log: lines `report_email` with `trigger: schedule`, and `report_skipped` for a month that went by with no send tried. The people listed under *If a send fails, also tell* get a message after the third failed try |
| The report went to a month twice, or two portals sent it | A crash, or a stop that did not wait long enough (it waits five seconds), between the mail server taking the message and the record being saved (the monthly send is at least once), or two copies of the portal both read the same Zabbix with the schedule on | Switch the copy that must not send off with `MAIL_SCHEDULE=off`. The Last sends list shows each |
| One person did not get the monthly report, though the Last sends list says it went | The mail server took the message for the others and refused that person's address: a mistyped address, or a mailbox that does not exist. The Last sends line says how many it refused, the `report_email` line in the log is a warning, and the people listed under *If a send fails, also tell* got one message with the numbers | Correct the address in the Schedule dialog and send that month by hand with Email report. The portal never says which address it was: it keeps no address in a log or a record |
| "Email report" says an address is outside the domains the portal may send to | `MAIL_ALLOWED_DOMAINS` names the domains a report may go to | Use an address at one of them, or ask an administrator of the portal to change the setting |
| A problem was acknowledged and still looks open | Zabbix applies a change a moment after it answers. For 15 seconds after a write the server keeps the affected answers for only 2 seconds, so the next reads are fresh, but Zabbix itself may still say open for a few seconds | The row says it is waiting. After a minute it says it is late and offers Ack again. A close works only if the trigger allows a manual close |
| Signed out again and again | Two portals on one machine share a cookie name, or `JWT_SECRET` or `SESSION_EPOCH` changed, or the session ended | Give each portal its own `SESSION_COOKIE`. Raising `SESSION_EPOCH` signs everyone out on purpose |
| A 429 on sign-in | More than 10 attempts a minute on one account from one address, or 10 failures in a row, which lock the account for a minute that doubles up to five | Wait. The log has a warning for every fifth failed attempt |
| The server will not start, and complains about a secret or a password | Sign-in is on and `JWT_SECRET` is empty, published in the repository or shorter than 32 bytes, or a password is empty or `admin` | Set them in `.env`. `openssl rand -hex 32` makes a secret |
| A page shows "This page hit an error", or the portal looks half loaded after a deploy | The tab was opened before the deploy and asks for files that no longer exist | Reload. The page does so once by itself |
| A role refusal: "This page is for operators" | The signed-in role is below what the page needs | Ask the portal admin, who edits the users setting |
| Everything is down | Docker is not running, or the Mac is not signed in | Start Docker Desktop. `docker compose ps` in each folder |
| After a restart the pages say the data source is not answering | The Mac is off HCML's office network, where Zabbix's LAN address answers | Join the network. The portals recover by themselves |
| A new build does not show a change | The image was not rebuilt | `deploy/rebuild.sh`. The footer of the page says the build |

## Why a host shows down, degraded or no data

A host's state is worked out by the server, ping first. The first rule that matches decides, and the tooltip on the state says which.

| Order | What the server finds | State | What the tooltip says |
|---|---|---|---|
| 1 | The host is disabled in Zabbix | Disabled | Monitoring is disabled for this host in Zabbix |
| 2 | A fresh ping answers, and no interface is marked unavailable | Up | Answers ping |
| 3 | A fresh ping answers, but an SNMP interface is unavailable | Degraded | Answers ping, but SNMP polling gets no reply |
| 4 | A fresh ping answers, but an agent interface is unavailable | Degraded | Answers ping, but the Zabbix agent is not reporting |
| 5 | A fresh ping answers, but another kind of interface is unavailable | Degraded | Answers ping, but a Zabbix interface is unavailable |
| 6 | A fresh ping says the host does not answer | Down | No reply to ping |
| 7 | No fresh ping, and Zabbix marks an interface available (the host is up) or unavailable (it is down) | Up or down | No fresh ping value. Zabbix marks the interface available, or unavailable |
| 8 | No fresh ping and no interface flag to go on, and the host has ping items that are supported, but none has a recent value | No data | No recent ping value: the last one is too old to trust |
| 9 | The host has no interface in Zabbix at all | No data | No interface in Zabbix, so the ping check can't run |
| 10 | Every ping item of the host is unsupported | No data | The ping check is not supported on this host |
| 11 | The host has interfaces and Zabbix does not know whether they are available, and no ping item | No data | No fresh ping value, and Zabbix doesn't know whether the interface is available |

A ping is fresh when its item is supported and its value is no older than three of its own update intervals, with ten minutes as the floor. A host that stays degraded is on rows 3 to 5: it answers ping, and one of its monitoring channels does not, so look at SNMP, the agent or the interface and not at the network path. The words in the last column are the web app's, in `web/src/shared/lib/severity.ts`, with a straight apostrophe where the code has a curly one. [Server: domain and hosts](../2-code/server-domain-and-hosts.md) has the code.

## When it is a bug

If none of the rows fit, gather four things before asking anyone: the reference id from the error, the `docker logs` lines around it, the health answer (signed in, so it has the version and the build), and the page's address with its query string, since the filters are in the address. With those, a developer can start from `server/src/index.ts` and [one request, from start to finish](../2-code/one-request.md), and does not have to start by asking what you did.
