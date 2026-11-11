# The traps

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 7 min | [Troubleshooting](troubleshooting.md) | [Exercises](exercises.md) |

Each of these cost time once, and most cost it more than once. They are grouped by where they bite. For each there is what happens, why, and what to do. The ones the code now defends against are marked, so that you know the defence is there and do not remove it.

## Reading Zabbix

| The trap | What happens | What to do |
|---|---|---|
| `lastvalue` on an item list | Zabbix looks each last value up on its own, 30 ms to 0.5 s for an item on HCML's. A host with 609 graphable items took 20 to 32 seconds to list (tracker BK-25) | Ask for names and ids, and take values from `history.get` through `recentValues`, or from `/api/latest`, which asks for a page only |
| `opdata` on the problem list | Zabbix fills it from history one problem at a time: 35 to 46 seconds for 650 problems, against 0.9 seconds without it | Leave it out of `PROBLEM_FIELDS`, and read it with `withOpdata` for the few problems that need it |
| Counting every item or trigger | About 40 seconds for the items and 74 for the triggers | Count in the background and keep it an hour, as `getStats` does. Never wait for it on a page |
| Everything arrives as text | A number in a test fixture hides a bug that text would cause | Give fixtures as text, as `zHost` and `zProblem` do |
| Zabbix keeps hosts and templates together | A count of hosts that does not filter is wrong by hundreds | Ask for monitored hosts, and for items and triggers with `monitored: true` |
| Trends can stall | This instance once stopped writing trends while history carried on, and a long graph ended days early | `getGraph` fills the tail from history for up to seven days. Do not remove the fill |
| One request for a long window | A year of trends in one request ran Zabbix's PHP out of memory, and the API said only "HTTP 500". A single page of the newest 10,000 events dropped the oldest ones silently | Use `fetchTrendsSliced` and `fetchEventsSliced`, which never accept a cut-off page |
| An empty `lastclock` | Zabbix reports `lastvalue` "0" with `lastclock` "0" for an item that never collected, and keeps the last value of an unsupported item. Both read as down | `isFresh` before believing a value. 42 links that were never polled once sat at the top as outages |
| Problems inside maintenance | `recent: true` returns solved and suppressed problems too | Count with `openProblems`. The Problems page shows the rest, marked |

## The server

| The trap | What happens | What to do |
|---|---|---|
| The order of hooks | A hook only reaches the routes registered after it, so the guard, the rate limit and the headers must come first in `index.ts` | Add a new hook where its neighbours are, and read the order in [one request](../2-code/one-request.md) |
| The guard judges the raw URL | The router decodes a path, so `/%61pi/hosts` reaches the `/api/hosts` handler, and a rule written against the raw text would let it through with no token | `requiredRole` is given the route the router matched. Keep it that way |
| Fastify coerces types | The text "false" becomes `false` and a list of one name becomes the name | `AJV_OPTIONS` turns it off, and the test helpers pass the same options |
| A cache key without its parameter | Two requests share an answer that differs. Or a report built while a month was still running is kept a day as that month's final figure | Put every parameter in the key, and put `closed` in the key of a month's report, as `getMonthlySli` does |
| A write and a cached read | After an acknowledge the first refetch can still read the problem as open, because Zabbix applies a close a few seconds late | `invalidate` the keys in `STALE_AFTER_WRITE` with a hold, and push the new list to the live screens |
| A stale copy that says nothing | A page passes an old copy off as just updated | Every read goes through `request`, which calls `noteStaleCopy`, and the page shows `StaleCopy` |
| Assistant prompt overflow | A prompt past the model's context window is cut from the front, which silently drops the rules | The snapshot is capped in characters by section. Keep each section's budget |
| The model's slot | A local model handles one request at a time, and waiting for another answer is not this one being slow | The timeout starts once the model is yours. Do not start it earlier |

## The web app

| The trap | What happens | What to do |
|---|---|---|
| `EventSource` cannot see a status | An expired session reconnects with the same dead credential for ever. A 502 while the server restarts makes it give up | `useSSE` asks `/api/auth/me` on a drop, and reopens a closed stream with backoff. Do not replace it with a bare `EventSource` |
| `setSearchParams(prev => ...)` | In one event, every call gets the same `prev`, and the second undoes the first | Use `useSearchPatch`, which reads the live address |
| A canvas cannot read `var()` | A chart keeps its light axes on a dark page | Read the tokens at render, as `TimeSeriesChart` does, and draw again when the theme changes |
| `AbortSignal.timeout` and `any` | Missing in older browsers | A plain controller joined to the caller's signal, as `request` does |
| A modal and the keyboard | Focus falls to the page when the opener disappears | `useDialogFocus`, and `focusMain` when the opener is gone |
| A first list is not a change | A highlight of "new" problems on page load would mark everything | `useChangeHighlight` takes the first list as a baseline |
| The two dark blocks | The dark theme's values are written twice, and nothing checks that they are equal | A new colour goes into the light block and both dark blocks |
| `localhost:5173/api/...` | Vite does not proxy `/api`, so it returns `index.html` with a 200 | The prefix is `/bff` |

## The repository

| The trap | What happens | What to do |
|---|---|---|
| The two copies | A shared file edited in one only, and a build that is not what you tested | `npm run check:parity`, and edit the shared tree in `hcml-portal` only |
| A copy that carries the machine's own file | `docker-compose.override.yml` names an internal address and must not be committed or copied between folders | It is ignored by git on this machine. Check what is staged before every commit |
| The repository is public | Anything committed is public, including a token, a host name from the estate and a screenshot with real names | No real host name, address or token in a file. Screenshots are anonymised first |
| A case-insensitive file system | A link that resolves on a Mac can 404 on a Linux runner | `links.check` matches each segment against the real listing. `os.listdir` tells the true case, and `ls` does not |
| A build from uncommitted files | The image is named for a commit it does not match | The rebuild script refuses, or labels the build `-dirty` and makes no tag |
| A `.env` line Docker cannot read | A rebuild once stopped after the images were tagged | The script checks the files first and shows the line number, not Docker's message, which can quote a secret |
| CI has never run | The image builds, `nginx -t`, the audit and the secret scan are untested until the account's billing lock is lifted | Do not call the pipeline proven. The checks pass on the developer's machine |
| A diagram edited after its render | The picture says something other than its source | Render again, look at it, and run `diagrams.stamp.mjs` last |
| A quoted snippet in the handbook | A quote of code that holds a dash, a curly quote or a long hexadecimal string fails the style and secrets rules | Quote with `lines=` around such a line, or describe it. The generated pages are rewritten by `npm run handover:build` and never by hand |
