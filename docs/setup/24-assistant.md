# 24. Assistant (chat)

[setup.md](../../setup.md) · previous: [§23](23-hardening-timeouts-rate-limiting-headers.md) · next: [§25](25-derived-sla-and-services.md)

The sidebar's Assistant page answers free-form questions about the estate: *"what needs
attention right now?"*, *"which site is in the worst shape?"*, *"are we meeting the SLA?"*. It is
the one feature with no Zabbix equivalent, and it is deliberately not an agent.

## What the model is given

For every message the BFF builds a snapshot, [`services/assistantSnapshot.ts`](../../server/src/services/assistantSnapshot.ts)
`buildSnapshot()`, from the same cached queries the pages use, under the same cache keys
(`problems`, `sites`, `sla`, `sli:*`, `services:tree`), so a busy conversation costs Zabbix nothing
the pages were not already paying:

- open problems, worst first, with host, age, acknowledgement state and tags, under a title that says how many of them
  are listed;
- facts counted over every open problem, which the list above may not hold in full: how many monitored hosts have none,
  the five busiest hosts with their counts, and the oldest problems still open;
- sites with reachable / unreachable / unknown counts and worst severity;
- every host by site on a small estate, or only the hosts that are not fine on a large one;
- SLA standing per service (achieved vs target, error budget left or exceeded);
- degraded services with the problems Zabbix blames for them.

The snapshot is plain text, not JSON: roughly half the tokens for the same facts, and a small
model reads *"3 hosts, 1 unreachable"* more reliably than nested braces. It is also capped.
Ollama serves `qwen3:8b` with a 4 096-token window by default, and a prompt that overflows it is
truncated from the *front*, which silently drops the system prompt and its rules. So the snapshot
is built in sections and each has a character budget that it fills with whole lines and no more (the estate 350, the counted facts 650, sites 900,
what is new 550, unreachable hosts 850, SLA standing 700, degraded services 400 and problems 1,850, about 5 500 characters
overall), the problem list stops at 20, `meta.truncated` says so when a list was cut, and the page shows *partial view*. `OLLAMA_CONTEXT_LENGTH` raises the window. SLA and
services are fetched with `Promise.allSettled`: a Zabbix without Services configured must not leave
the assistant unable to say what is down.

Host, site, problem, service and SLA names are text typed into devices and Zabbix, so before they
enter the prompt each one is cut to a single line (control characters and line breaks become
spaces), capped at 80 characters for a host or site and 200 for the rest, and the snapshot and the
focus blocks sit between `~~~ BEGIN` and `~~~ END` lines that the system prompt calls data,
never instructions (`promptText()` in `services/assistantLines.ts`).

## What the model may do

Nothing. The system prompt confines it to the snapshot, forbids inventing hosts, numbers or causes,
asks for plain text (no markdown: the panel renders text, not HTML), and tells it that
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
2 000 characters, ending with a user turn; the page itself sends the last 12), then hijacks the reply and writes SSE frames as
`streamAnswer()` yields text. `EventSource` cannot POST, so the browser reads the stream with `fetch`
+ `ReadableStream` in [`api/assistant.ts`](../../web/src/api/assistant.ts) `chatStream()`. A reader who navigates away closes
the socket; the route aborts the upstream request so the model stops generating for nobody.

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

`viewer`. The snapshot contains only what a viewer can already open: Problems, Sites, SLA,
Services; the Links and Network views, which start at the wall role, are not in it. The route is a POST, but not a
write: the surface test pins both non-GET routes and states which one touches Zabbix. It is
rate-limited like any other request.


## Limits and the notice on AI answers (7 October 2026, SC-01, SC-09)

- The notice. When the hosted Anthropic backend is configured (`AI_PROVIDER=anthropic`) the Assistant and Explain say, under every answer, what left the machine: "Each question, and a summary of the estate, is sent to Anthropic, an external AI service" and "To write this, the details shown here were sent to Anthropic, an external AI service". It follows `aiExternal` in `GET /api/health`. With a local model, as in hcml-portal-ollama, nothing is shown.
- Per-user limits. Each signed-in user, or each client address when sign-in is off, may make `AI_CHAT_PER_MINUTE` Assistant questions and `AI_EXPLAIN_PER_MINUTE` explanations a minute (10 each). Over it is `429 rate_limited` with `Retry-After`. The count is kept in memory, so a restart gives everyone a fresh allowance.
- Concurrency. `AI_MAX_CONCURRENT` (4) hosted calls run at once; the next waits its turn and is told the assistant is busy after about 20 seconds. A local model still takes one at a time. That slot belongs to one BFF process: a second BFF pointed at the same Ollama does not see it, so its question would run while another is answering and wait inside Ollama, with no word to the reader. Run one BFF per Ollama server. Setting `OLLAMA_NUM_PARALLEL` in Ollama's own environment lets Ollama take several questions at once, which only matters with more than one BFF, and needs memory for each (tracker IN-21).
- Daily token budget, hosted only. `AI_DAILY_TOKENS_PER_USER` (500,000) and `AI_DAILY_TOKENS_TOTAL` (2,000,000), counted from the tokens the API says it billed and reset at midnight in `SLA_TIMEZONE`. Used up is `429 ai_budget` with the time to midnight. `0` switches a budget off. A local model has no bill and no budget.
