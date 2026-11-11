# Choices compared

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Everyone | about 15 min | [The decisions, in plain words](decisions.md) | [History](history.md) |

Three choices come up whenever someone plans to run the portal: how a request travels and what the portal is built on, whether its AI model is hosted or local, and whether the portal gets a machine of its own or shares the one Zabbix runs on. This page puts each side by side and says what the project recommends. Prices and sizes carry a date, because they change. Where something has not been measured, the page says so.

## The short answers

| Question | Recommended | What decides it |
|---|---|---|
| How does it work, and on what? | A browser app and a small server that read Zabbix's API and keep almost nothing (one small state file in the hosted copy) | Nothing to decide: this is how it is built |
| A hosted or a local model? | Both are built, and the setting `AI_PROVIDER` switches between them | Whether HCML lets host names and problem text leave the company |
| A VM of its own, or Zabbix's? | A VM of its own | Zabbix's load and upgrades stay apart from the portal's, and a local model needs a large machine |

## 1. How a request travels, and what it is built on

### The path

1. A person opens the portal. The address leads to nginx, in the first of two containers.
2. nginx sends the web app's files to the browser and passes every address that starts with `/bff` to the second container, the server.
3. The server checks who is asking: the host, the rate limit, the signed session cookie and the role behind it.
4. A route checks what was asked and calls a service.
5. The service looks in its cache first. A fresh copy answers at once.
6. Without one, the service asks Zabbix through its API with a read token.
7. The service turns Zabbix's answer into what the page needs and keeps a copy in memory for a while.
8. The browser draws the page, and says how old the data is when it is more than a couple of minutes old.

[One request, from start to finish](../2-code/one-request.md) walks through the eighteen steps behind these eight. When a page is slow on a large question, the time is spent at step 6, inside Zabbix, and not in the network or in the portal.

### The stack, layer by layer

| Layer | What it is made of | Why |
|---|---|---|
| Browser app | React 18, React Router 7, ECharts 6, TypeScript, built with Vite 8 | One language on both sides, a large and plain ecosystem, and no state library |
| Web server | nginx 1.30, unprivileged, on Alpine | It serves the built files, passes `/bff` on and sets the security headers |
| Server | Node 24, Fastify 5, TypeScript | The same language as the browser app, request schemas and a clear order of hooks |
| Data | The Zabbix 7.0 API over HTTPS, with a read token | The portal copies nothing and has no database |
| AI, optional | A hosted model, or a local one through Ollama | One setting switches; without a model the AI buttons are hidden |
| Platform | Linux, Docker and Compose | Two containers, each with a read-only filesystem and no extra privileges |

### Compared with Zabbix's own screens

| | Zabbix's own screens | This portal |
|---|---|---|
| What it is | A PHP application beside Zabbix's database | A separate web app beside Zabbix |
| What it reads | Zabbix's database | Only Zabbix's API |
| Changing a screen | Code inside Zabbix, which an upgrade can overwrite | Code outside Zabbix, which Zabbix upgrades do not touch |
| Changing what is monitored | Yes: that is what Zabbix is for | No: it only reads, apart from acknowledge and close |
| What you maintain | Nothing extra | An application, with its tests, its checkers and a rebuild script |

## 2. A hosted AI model or a local one

Two features use a model. Explain writes one problem or one SLA figure in plain words, and the Assistant answers questions about the estate. The model is optional, and [AI providers](../3-integrations/ai-providers.md) says how it is set up.

### Side by side

| | Hosted model (Claude, through its API) | Local model (Ollama, qwen3:8b) |
|---|---|---|
| Where the data goes | Host names, problem text, tags and an estate summary of up to 5,500 characters go to the provider with every question | Nothing leaves the machine |
| Answers | Expected to be stronger, in a few seconds; the portal waits 30 seconds a try and tries once more | From a small model, slower: the portal waits up to 120 seconds. In a test on a laptop, a full-size prompt took 6 seconds to read with a graphics chip and 129 seconds with the processor only (test below) |
| Server | Small: the portal alone | Larger: the model takes about 6 GB of memory, and a graphics card is advised |
| Cost per question | A fraction of a cent to about two cents (next table) | None |
| Needs | Internet, an API key and a written approval to send the data | A machine of the size below |
| Measured here | Not measured on HCML's data: the key was refused when the checks were due | On 26 October the 4 questions about a whole list were wrong, out of 7 asked; after the portal changed what it sends, 8 of 8 questions were right (tracker row BK-20). Memory and speed were measured on a laptop on 2 November (test below) |

### What the hosted model costs for 15 users a year

List prices on 2 November 2026, per million tokens: Claude Sonnet 4.6, the default of the portal's `AI_MODEL` setting, costs $3 in and $15 out; Claude Sonnet 5.5 costs $2 in and $10 out; and Claude Haiku 5.5 costs $0.10 in and $0.50 out (for prompts up to 100,000 tokens). One question is taken as 3,000 tokens in and 500 out, which makes it about $0.0165 on Sonnet 4.6, $0.011 on Sonnet 5.5 and $0.00055 on Haiku 5.5. A year is 250 working days.

Where the 3,000 and the 500 come from: the Assistant's prompt is its rules (about 3,400 characters), the estate snapshot (at most 5,500 characters), and the earlier turns and the new question together (at most 3,000 characters). A question that names sites or hosts adds a block of detail on up to two sites and two hosts, at most 800 characters each. In the test below, a full-size prompt without that block, 9,096 characters, came to 3,186 tokens as the local model counts them; Claude counts differently, and its newer models count more (see the note under the table). The Assistant's answer is capped at 700 tokens (an Explain answer at 2,048) and the rules ask for two to four short sentences: the test answer was 34 tokens. So the 3,000 in is close for a question that names nothing and can be higher for one that does, and the 500 out errs high. The two errors pull in opposite directions, so the real cost of a question can sit on either side of the table. Nothing has been measured with Claude on HCML's data.

| US dollars a year | Light (5 questions a day each) | Typical (15) | Heavy (35) | Ceiling at the portal's limit |
|---|---|---|---|---|
| Claude Sonnet 4.6 (the default setting) | 309 | 928 | 2,166 | 3,441 |
| Claude Sonnet 5.5 | 206 | 619 | 1,444 | 2,294 |
| Claude Haiku 5.5 | 10 | 31 | 72 | 115 |

Claude Sonnet 5.5 and Claude Haiku 5.5 use a newer tokenizer than Claude Sonnet 4.6. Anthropic's pricing page, read on 3 November 2026, says that it produces approximately 30 percent more tokens for the same text, and that the exact increase depends on the content. So for the same questions the Sonnet 5.5 and Haiku 5.5 rows can be about 30 percent higher than the table shows, and for the same text Sonnet 4.6 costs about 1.15 times Sonnet 5.5, not 1.5 times. The ceiling column does not move, because the portal's cap counts tokens.

The portal caps its own use: 10 Assistant questions and 10 Explain requests a minute for each person, 500,000 tokens a day for each person and 2,000,000 a day for everyone (`AI_DAILY_TOKENS_PER_USER`, `AI_DAILY_TOKENS_TOTAL`). The portal counts them in its own memory, so a restart sets them back to zero, and it checks them before a call, so the last call of a day can take a total past its cap. The ceiling is those 2,000,000 tokens every day of the year, at the same mix of 3,000 in and 500 out. If every token were output, the same cap would allow up to $10,950 on Sonnet 4.6, $7,300 on Sonnet 5.5 and $365 on Haiku 5.5, and a model that thinks first bills that thinking as output, so a real bill can sit above the table. A local model has no bill, and the portal does not count it against these budgets.

### What each needs from the machine

| | With a local model | With the hosted model |
|---|---|---|
| Processor | 8 cores with AVX2 | 2 cores |
| Memory | 16 to 24 GB (the model alone took 6.0 to 6.1 GB in the test below) | 4 GB |
| Disk | 60 GB SSD | 30 GB |
| Graphics card | Advised, with 8 GB or more of its own memory (see the test below) | None |

These are estimates, not benchmarks. HCML IT should confirm them on the machine it provides. The portal's own containers are capped at 2 cores and 2 GB for the server and 1 core and 256 MB for the web server. At rest, with no data source, the two containers took about 45 MiB (server) and 10 MiB (web) on the test Mac, and their images are 281 MB and 84 MB. With HCML's data the caches fill, so these are a floor and not the working size.

### A test of the local model

On 2 November 2026 the local model was run on an Apple M5 laptop (10 cores, 24 GB) with Ollama 0.33.3 and `qwen3:8b` (Q4_K_M, 8.2 billion parameters, 5.2 GB on disk). The request had the portal's own options (an 8,192-token context, thinking off) and a prompt of the size the Assistant builds: its rules and a made-up snapshot of 5,446 characters, close to the 5,500 cap, 9,096 characters and 3,186 tokens in all. The names in the snapshot are invented, so the test measures size and speed and says nothing about the quality of an answer.

| | With the graphics chip | With the processor only |
|---|---|---|
| Memory taken by the loaded model | 6.0 GB | 6.1 GB |
| Loading the model | 2.8 s | 4.8 s |
| Reading the prompt | 6.2 s (517 tokens a second) | 128.9 s (25 tokens a second) |
| Writing a short answer | 1.6 s (34 tokens, 22 a second) | 3.8 s (30 tokens, 8 a second) |
| The whole call | 10.6 s | 137.6 s |

The processor-only call took longer than the 120 seconds the portal waits for a local model. When someone opens the Assistant page, the portal has the model read the snapshot in the background, so that the first question pays only for its own words. That read holds the model, and the portal cuts it off at 120 seconds. With the processor only it needs about 129, so it would not finish: a question asked while it runs waits up to 20 seconds and is then told the assistant is busy, and a question asked on its own has to read the whole prompt and meets the same 120-second limit. With the graphics chip the read takes 6 seconds and none of this arises. One request was made at a time; Ollama sets aside more memory for each request it serves in parallel. An HCML VM's processor will be faster or slower than this laptop's, so the test should be repeated on the VM before the local route is chosen.

### Which to choose

At 15 users the hosted bill stays small, at most $115 a year on Haiku 5.5, $2,294 on Sonnet 5.5 and $3,441 on Sonnet 4.6 at the assumed mix, so the money does not decide it. How that compares with the cost of the larger machine is for HCML IT to say. The data decides. If HCML approves in writing that estate data may go to the provider, the hosted model costs less to run and answers better. If it does not, use the local model and give the portal the larger machine, with a graphics card (advised in the test above). Switching later is a setting (`AI_PROVIDER`, with `AI_BASE_URL` and `AI_MODEL`) and a test, not a rebuild. A third arrangement puts the local model on a machine of its own, and then only `AI_BASE_URL` changes.

## 3. A VM of its own, or the Zabbix server's

| | A VM of its own | The same machine as Zabbix |
|---|---|---|
| Load on Zabbix | None from the portal or the model | The portal shares Zabbix's processor, memory and disk, and a local model would take most of the processor |
| If the portal misbehaves | Zabbix keeps running | It can slow Zabbix down |
| Upgrades | Zabbix and the portal are upgraded apart | One maintenance window, with Docker on Zabbix's host |
| Reaching Zabbix | Over the network: IT opens the route, and the certificate has to check out | On the same machine: no route and no certificate to arrange |
| Security | Users reach the portal's machine, and Zabbix's stays closed to them | A web app that users reach runs on the monitoring server |
| Size and cost | One more VM, of the size above | No new VM, but Zabbix's machine grows by the same size |
| Recovery | The portal keeps almost no data: rebuild it from the repository and restore the settings files, and in the hosted copy one small state file | Restoring Zabbix's machine restores both, or neither |

Our recommendation is a VM of its own, because it is the choice that cannot hurt monitoring. The case for sharing is real but narrow. It needs the hosted model, so that the portal stays small, a measurement by IT that Zabbix's machine has the spare capacity, and a shared maintenance window that the NOC accepts. With a local model the machines must be apart. What to ask HCML IT for is listed in [What HCML provides](../0-everyone/what-hcml-provides.md).

## What this page does not know

- The price of a VM at HCML. IT knows it, and the sizes above are the only input.
- How the hosted model answers on HCML's data. The portal's checks of it were stopped by a refused key.
- The real number of tokens per question with Claude. The 3,000 in and 500 out are an assumption that the test above makes plausible and does not prove, and the portal's own usage figures will replace them once the hosted model runs. The newer models also count about 30 percent more tokens for the same text (see the note under the table).
- How the local model performs on an HCML VM. The test used a laptop; the VM's processor and any graphics card decide the real times.
- How busy Zabbix's machine is at the hours the portal would work. Only HCML IT can read that.
