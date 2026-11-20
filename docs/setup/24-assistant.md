# 24. Assistant (chat)

[setup.md](../../setup.md) · previous: [§23](23-hardening-timeouts-rate-limiting-headers.md) · next: [§25](25-derived-sla-and-services.md)

The sidebar's Assistant page answers free-form questions about the estate: *"what needs
attention right now?"*, *"which site is in the worst shape?"*, *"are we meeting the SLA?"*. It is
the one feature with no Zabbix equivalent, and it is deliberately not an agent.

## What the model is given

For every message the BFF builds a snapshot, [`services/assistantSnapshot.ts`](../../server/src/services/assistantSnapshot.ts)
`buildSnapshot()`, from the same cached queries the pages use, under the same cache keys
(`problems`, `sites`, `sla`, `sli:*`, `services:tree`), so a busy conversation costs Zabbix little beyond what the pages already pay. The snapshot is reused for five minutes, but each rebuild also asks Zabbix, uncached, for the operational data of up to 28 open problems (`problem.get` with `opdata`, about 54 ms for each) and starts the three derived-SLA reads:

- open problems, worst first, with host, age and acknowledgement state (no tags), under a title that says how many of them
  are listed;
- facts counted over every open problem, which the list above may not hold in full: how many monitored hosts have none,
  the five busiest hosts with their counts, and the oldest problems still open;
- sites with reachable / unreachable / unknown counts and worst severity;
- the internet links, for a person whose pages show the Internet view: the traffic in and out of each gauge of the Zabbix dashboard that the Dashboard's Internet view draws, as a share of its capacity, a link that is down said to be down and a link with no reading said to have none (`services/assistantInternet.ts`); when a question names a site, that site's links are listed in full in its FOCUS block;
- the hosts that are unreachable, by site;
- SLA standing per service (achieved vs target, error budget left or exceeded);
- degraded services with the problems Zabbix blames for them.

The snapshot is plain text, not JSON: roughly half the tokens for the same facts, and a small
model reads *"3 hosts, 1 unreachable"* more reliably than nested braces. It is also capped.
Ollama serves `qwen3:8b` with a 4 096-token window by default, and a prompt that overflows it is
truncated from the *front*, which silently drops the system prompt and its rules. So the snapshot
is built in sections and each has a character budget that it fills with whole lines and no more (the estate 350, the counted facts 650, sites 900,
what is new 550, unreachable hosts 850, internet links 700, SLA standing 700, degraded services 400 and problems 1,850, at most 6 200 characters
overall), the problem list stops at 20, `meta.truncated` says so when a list was cut, and the page shows *partial view*. `OLLAMA_CONTEXT_LENGTH` raises the window. SLA and
services are fetched with `Promise.allSettled`: a Zabbix without Services configured must not leave
the assistant unable to say what is down.

Host, site, problem, service and SLA names are text typed into devices and Zabbix, so before they
enter the prompt each one is cut to a single line (control characters and line breaks become
spaces), capped at 80 characters for a host or site and 200 for the rest, and the snapshot and the
focus blocks sit between `~~~ BEGIN` and `~~~ END` lines that the system prompt calls data,
never instructions (`promptText()` in `services/assistantLines.ts`).

## What a question gets beyond the snapshot

The snapshot is small on purpose, so it holds the estate as it is now and nothing of the past or of one device's readings. A question that asks for more has it read on the spot, the way a site's FOCUS block is: [`services/assistantDetail.ts`](../../server/src/services/assistantDetail.ts) `buildDetails()` reads the words of the question (English and Bahasa Indonesia, [`assistantTopics.ts`](../../server/src/services/assistantTopics.ts)) and the hosts and sites it names, asks Zabbix only for that, and adds a block to the FOCUS part of the prompt. The model asks for nothing and has no tools: the portal decides what to read ([ADR-0019](../architecture/adr/0019-let-the-portal-read-what-a-question-needs.md)). The word list is a screen and not a judge: a question it misses is answered from the snapshot alone, and one it catches by mistake costs a read the model does not use.

| The question asks about | What is read | The user's pages must include |
|---|---|---|
| A time that has passed: "tadi malam", "kemarin", "minggu ini", "last 3 hours", "how many times did X go down this week" | The problems that opened in that window, closed or not, from Zabbix's event history, grouped by host and trigger: Average and above, at most 500, a window of at most 31 days. The block says which window it understood | Problems |
| The latest values of a host or a site: CPU, memory, temperature, disk, traffic, uptime, ping | For a host, a line for each metric; for a site, the highest of one metric and how many hosts have a current reading (CPU and memory from the list that the Dashboard's Top hosts keeps for every host, the rest by item); with no host or site named, the busiest hosts of the Dashboard. A reading older than its item's interval is said to be old and is never given as current, and an item that Zabbix reports as not supported says so | Latest data (traffic also the network pages, the busiest hosts the Dashboard) |
| The course of a value: "rata-rata CPU switch X kemarin", "grafik suhu seminggu terakhir" | The lowest, average, highest and last of the host's item over the window, the figures that the Graphs page computes, never points | Graphs |
| What a host is: its address, groups, templates, tags, inventory, maintenance | The state, groups, templates and the maintenance window; the address only for a model on this machine; the tags and the inventory only for a model on this machine and a person who has the Inventory page (SC-65), and so are the description of a host and the name of a maintenance window | Hosts or Devices (tags, inventory, description and the name of a maintenance window: Inventory as well) |
| A person: "siapa penanggung jawab di Surabaya?" | The contacts on record in the inventory, or the plain statement that Zabbix holds none; only for a model on this machine | Inventory as well |
| Who acknowledged a problem, and why: "siapa yang acknowledge problem di Pasuruan?" | The updates of the acknowledged problems that are open now, of any age, or of those that opened in the window named; names and reasons only for a model on this machine and only for an operator or an administrator, since only they can acknowledge (SC-65); a model outside it, and a person below operator, are told that the problem was acknowledged, how often and when last | Problems |
| The SLA of another window: "SLA bulan September jam kerja", "SLA tahun ini", "SLA minggu lalu" | The portal's strict figure for the window, from months read once and kept (ADR-0018), with the sites below target and the worst devices; "jam kerja" is 08:00 to 17:00 on weekdays. A window that touches more than four calendar months is not read, and the block says to ask for four or fewer, since each month not read before takes minutes. Last month and this month over every hour are in the snapshot already | SLA |
| Every open problem: "sebutkan semua problem High di Pasuruan" | All the open problems of the site, the host or the severity named, from the problem list that is kept; the whole estate is counted and not listed | Problems |
| Maintenance: "ada maintenance terjadwal?" | The windows that are active or coming up, with their hosts and groups | SLA, Hosts, Devices or Sites |
| The WAN links and the web checks: "latency link WAN di Surabaya", "web check mana yang gagal" | The links in the words of the Links & WAN health page, worst first; the web checks that pass, fail or have no current result, and the failing ones with their step | Links; Dashboard, Hosts or SLA |
| One port: "port Gi1/0/12 di switch X up atau down?" | The interface's status, speed, traffic in and out and errors from the Network page's rows; when nothing matches, how many interfaces the host has | Network |
| The report pages: capacity, alert noise, the top triggers, the inventory scorecard | A few lines of each, at the periods the pages offer (a number of days that is not one of them is moved to the nearest, BK-88); the scorecard for an administrator only | The report's own page |
| Maps: "apa yang terhubung ke switch X di peta?" | What the host is linked to on Zabbix's maps, or the maps there are; without the network devices for a user without the network pages | Maps |

The portal keeps the internet gauges, the WAN links, the web checks and the list of busiest hosts for ten minutes after the last request to them, and each can take 15 to 45 seconds to build, so a question about one of them waits for a cold read of it (at most 50 seconds, before the model is asked), and opening the Assistant page starts the busiest hosts. Each read has nine seconds, because HCML's Zabbix is slow, and a read that fails is written into the block as "could not be read from Zabbix in time", so that the model does not take silence for "none". An SLA window or a report that has not been read before takes one to two minutes (98 and 131 seconds for two SLA windows, 60 seconds for the capacity report): after the nine seconds the block says that it is still being worked out, the read carries on, and the next question finds it. The blocks together stay within 2,800 characters, and a block that would pass that is left out whole. A model outside this machine (`AI_PROVIDER=anthropic`, or a remote server let through) is given the state, groups and templates of a host and no address, tag, inventory or contact, and only the fact of an acknowledgement, because a tag, a field or a reason may hold a person. The `chat answered` log line has a `detail` field that says which kinds were read.

The slow reads share the places the report pages use (BK-88). A question that needs a heavy report or a month of SLA takes one of the person's places in the line of heavy reports (four a person) or of SLA reads for as long as the read is pending, and the block says that the person already has four reports being prepared when none is free. A place is freed by the read it was taken for, when that read ends, so a question that stopped waiting after nine seconds still holds it while the work carries on; a reader who leaves frees theirs at once and stops the reads that can be stopped (BK-91), and an answer that was given whole leaves its slow reads to finish into the cache, where the next question finds them. A part that the person's pages leave out is named in the system text, beside the data and not inside the fence the model is told never to obey, as `NOT GIVEN TO THIS USER`, so that the model says the account does not have the page and does not answer "none" (BK-84). The interface traffic is one of them for a person who has the values and the graphs and not the Network page.

What a model outside this machine is never given (SC-64, SC-69, SC-72): the address of a host; its tags (those of an event as well, which Explain does not send), inventory fields and contacts; the far end and the label of a WAN link; the description of a host; the alias of an interface, also where it stands inside the name of an interface item; the labels of the links of a map, and of a map element that is not a host; the name of a maintenance window; and the names and reasons of an acknowledgement. Free text that staff write can hold a person, so none of it leaves for an outside model; the other text from Zabbix is cut to one line first, and so are the units, port names and values that a reading carries.

What the Assistant still cannot give: the root cause of a problem, which is not data in Zabbix and is not guessed; anything newer than the snapshot (reused for five minutes, and rebuilt at once when a problem opens, closes or is acknowledged) and the slow views the portal keeps (up to ten minutes); and anything that the user's pages do not show.

## What the model may do

Nothing. The system prompt confines it to the snapshot, forbids inventing hosts, numbers or causes,
asks for short answers in plain words with light markdown only (**bold** for a key host, site or number, and "- " bullets), which the panel renders and shows as text and never as HTML, and tells it that
acknowledging is done on the Problems page by operators. It has no tools. A wrong answer is the
worst case, which is why the page footer says to confirm on the relevant page before acting.

## How it flows

```
Browser ──POST /bff/api/chat {messages} ──► BFF ──► buildSnapshot()     (cached Zabbix reads)
        ◄── text/event-stream ──────────────────├──► streamAnswer()     (the model, streaming)
            event: context   what it was shown  └──► frames written as tokens arrive
            event: token …
            event: done | error
```

[`routes/chat.ts`](../../server/src/routes/chat.ts) has [`services/chat.ts`](../../server/src/services/chat.ts) validate the body (the newest turns up to 3 000 characters together, each cut to
2 000 characters, ending with a user turn; the page itself sends the last 12 and stops a question at 2,000 characters, with a counter from 1,800), then hijacks the reply and writes SSE frames as
`streamAnswer()` yields text. `EventSource` cannot POST, so the browser reads the stream with `fetch`
+ `ReadableStream` in [`api/assistant.ts`](../../web/src/api/assistant.ts) `chatStream()`. A reader who navigates away closes
the socket; the route aborts the upstream request so the model stops generating for nobody, and what was still being read for the question is not read (BK-91).

The memory of the conversation is the 3 000 characters, not the 12 turns, and the page shows where it ends (FR-72). The `done` frame carries `remembered`, how many turns the model was given with the question, and the page marks the older messages and draws a line at the point. A message that was stopped by the reader, that failed, or that the model cut at its length limit (`truncated`) carries a mark that says so (UX-72); the `done` frame also carries `language`, the language the answer was asked in, so that the page sets `lang` on it (UX-73). The log of the page can be reached by keyboard, and each message is labelled You or Assistant.

Nothing is kept server-side between messages: the page holds the conversation and sends it back
each time, which is also why *Clear* is nothing more than emptying the page's state.

## Reasoning models: the measurement that changed `ai.ts`

Qwen3 thinks before it answers by default. Measured on Ollama 0.33 with `qwen3:8b`, one short
question:

| Lever on `/v1/chat/completions` | Wall time | Hidden reasoning |
|---|---|---|
| `/no_think` in the system prompt | 14.3 s | 945 characters |
| `think: false` | 12.9 s | 789 characters (parameter ignored) |
| `reasoning_effort: "none"` | 2.0 s | none |
| native `/api/chat` + `think: false` | 1.9 s | none |

The same held with a JSON schema attached, i.e. the explain layer had been paying ~1 000 characters
of reasoning on every call. Ollama files that reasoning into a separate `reasoning` field rather
than `content`, which is why it went unnoticed: nothing leaked into the answer, it just took five
times as long. `thinkingControl()` in [`ai.ts`](../../server/src/clients/ai.ts) now sends `reasoning_effort:
"none"` for known reasoning families, for the assistant *and* the explain layer, and
`readOpenAiStream()` drops any `reasoning` deltas so the reader never sees the model think.

## RBAC and rate limiting

The snapshot, the focus and what a question gets beyond them hold only what the pages of the person asking show
([ADR-0017](../architecture/adr/0017-keep-the-portals-users-in-a-file-of-their-own.md)): a person with only the SLA page is
given the SLA and the services and nothing about hosts, problems or links, and an administrator is given all of it. The route is a POST, but not a
write: the surface test pins both non-GET routes and states which one touches Zabbix. It is
rate-limited like any other request.


## Limits and the notice on AI answers (7 October 2026, SC-01, SC-09)

- The notice. When the model is outside this machine's own network, as hosted Claude always is (`AI_PROVIDER=anthropic`), the Assistant and Explain say, under every answer, what left the machine: "Each question, and a summary of the estate, is sent to Anthropic, an external AI service" and "To write this, the details shown here were sent to Anthropic, an external AI service". For another provider they say "an external AI service" and name nobody, which is what a person sees in hcml-portal-ollama when `AI_ALLOW_REMOTE=true` lets a model outside the network through. It follows `aiExternal` in `GET /api/health`. With a local model nothing is shown.
- Per-user limits. Each signed-in user, or each client address when sign-in is off, may make `AI_CHAT_PER_MINUTE` Assistant questions and `AI_EXPLAIN_PER_MINUTE` explanations a minute (10 each). Over it is `429 rate_limited` with `Retry-After`. The count is kept in memory, so a restart gives everyone a fresh allowance.
- Concurrency. `AI_MAX_CONCURRENT` (4) hosted calls run at once; the next waits its turn and is told the assistant is busy after about 20 seconds. A local model still takes one at a time. That slot belongs to one BFF process: a second BFF pointed at the same Ollama does not see it, so its question would run while another is answering and wait inside Ollama, with no word to the reader. Run one BFF per Ollama server. Setting `OLLAMA_NUM_PARALLEL` in Ollama's own environment lets Ollama take several questions at once, which only matters with more than one BFF, and needs memory for each (tracker IN-21).
- Daily token budget, for the hosted API and for a model outside this machine's network. `AI_DAILY_TOKENS_PER_USER` (500,000) and `AI_DAILY_TOKENS_TOTAL` (2,000,000), counted from the tokens the model says it used (else an estimate of what went in and out) and reset at midnight in `SLA_TIMEZONE`. Used up is `429 ai_budget` with the time to midnight. `0` switches a budget off. A model on this machine has no bill and no budget.
