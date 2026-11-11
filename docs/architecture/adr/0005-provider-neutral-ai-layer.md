# A provider-neutral plain-language layer, and two repositories over one source tree

* Status: accepted
* Deciders: HCML internship project
* Date: 2026-09-18 (recorded as an ADR 2026-09-22)

## Context and Problem Statement

The portal explains problems and SLA figures in plain language, and answers questions about the
estate. Doing that means sending HCML's monitoring data (host names, trigger text, site rollups) to
a language model. HCML's source documents are stamped Private and Confidential.

Two questions, and they turned out to be one: which model, and how do you evaluate that choice
rather than assert an answer?

## Decision Drivers

* Whether estate data leaves the machine must be a deliberate, visible choice.
* The two options must be comparable (same features, same prompts, same pages) or any comparison is
  worthless.
* Maintaining two diverging codebases by hand is a known way to ship two different bugs.

## Considered Options

* Hosted model only (Anthropic API).
* Local model only (Ollama on the host).
* One provider-neutral layer, switched by configuration, deployed twice: once per backend.

## Decision Outcome

Chosen: **one provider-neutral layer (`server/src/clients/ai.ts`), switched by `AI_PROVIDER`, deployed as two
repositories that share a byte-identical source tree.**

`hcml-portal` runs hosted Claude. `hcml-portal-ollama` runs `qwen3:8b` on the host. `server/src` and
`web/src` are byte-identical between them: verified with `diff -rq`, not by eye. Which model
answers is a line of `.env`.

### This copy's perspective

**This is `hcml-portal-ollama`: the plain-language layer is `qwen3:8b` running on this host, and
nothing about the estate leaves the machine.** Explain and the assistant send the same data the
sibling sends to Anthropic (host names, trigger text, the estate snapshot) but it travels to
`localhost:11434` and stops there. For that reason the line the sibling shows under every AI answer,
naming Anthropic as the external service, never appears here. The per-user limits on Explain and the
assistant (10 calls a minute each) are the same in both copies; the daily token budget counts the
hosted API only, so it does nothing here.

`flow/DataFlow.pdf` draws that box green, and carries no trust boundary at all, because there is
none to draw. In the sibling repo the same box is red and reads *LEAVES THIS MACHINE*.

What it costs: measured on 18 September, first token 9.7 s cold against 1.3 s hosted, and 13.9 s
for a whole answer against 5.3 s. The warm-up route exists because of exactly that: on the hosted
provider it is a no-op, here it loads the weights so the first real question is not paying for the
cold start.

### Positive Consequences

* The comparison is real. Both copies run the same code against the same estate, so a difference
  in answer quality or latency is a difference in the model, not in the harness.
* Switching backends is one environment variable, not a branch.
* A single bug fix lands in both, and `diff -rq` proves it did.
* The privacy question became a measurable trade rather than an argument.

### Negative Consequences

* **Two deployments to keep in step, forever.** The divergence is now 22 files and both READMEs state
  the count, so both have to be updated whenever it changes, and that count has already drifted once
  (audit finding DOC-10).
* **`AI_PROVIDER` falls back to `anthropic` for any unrecognised value, with only a warning in the
  startup log** (none at all for an empty value). A typo like `AI_PROVIDER=ollama` selects the
  hosted backend with no error and nothing in the UI. With no Anthropic key, as in this copy, that
  turns the AI off; with a key added, it would send the estate off-box. On 21 Sep the local-model
  repo's own `.env.example` was found selecting the *hosted* backend (finding B3): the exact failure
  this footgun enables. Since 24 September 2026 this copy's `docker-compose.yml` fixes
  `AI_PROVIDER` to `openai-compatible` and passes no Anthropic key, so the Docker deployment cannot
  fall back. Under `npm run dev`, `config.ts` still falls back to `anthropic` for an unset value, but
  this copy's `.env` files carry no Anthropic key, so that path turns the AI off.
* `@anthropic-ai/sdk` is installed in both copies and unused in one.
* Two stacks means two caches, two restarts, and twice the recompute cost of anything not persisted.
* The API key was flagged for rotation on 10 September (FE-02). The key the running hosted portal holds was
  refused by Anthropic on 16 October (401, `invalid x-api-key`), so it no longer works; replacing it is the
  owner's (SC-01).

## Pros and Cons of the Options

### Hosted model only

* Good, because answer quality is high and there is nothing to run.
* Bad, because every Explain sends production estate data to a third party, with no local alternative
  to compare against.

### Local model only

* Good, because nothing leaves the machine.
* Bad, because it is materially slower. Measured 18 Sep: first token 9.7 s cold against 1.3 s hosted,
  and it needs a model runtime maintained on the host.
* Bad, because with no hosted comparison there is no way to say what the privacy is costing.

### Provider-neutral, deployed twice

* Good, because it answers both the product question and the evaluation question at once.
* Bad, because it is the only option that creates a permanent two-deployment maintenance burden.

## Links

* Follows [ADR-0002](0002-react-typescript-fastify.md)
* `setup.md` §13 *Plain-language layer*, §24 *Assistant*
* `flow/DataFlow.pdf`: the trust boundary, drawn per copy
* `server/src/clients/ai.ts`, `server/src/services/assistant.ts` (the entry) and the `assistant*.ts` pieces behind it
