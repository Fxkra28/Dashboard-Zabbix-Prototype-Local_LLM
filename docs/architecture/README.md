# Architecture

The system at rest, the system in motion, and why it is shaped the way it is.

## Why it is the way it is

[Architecture Decision Records](adr/): fifteen decisions in MADR format, each with what was
considered, what was chosen, and what it cost. Start with
[ADR-0001](adr/0001-bff-over-zabbix-api.md) if you are new; it explains why there is a portal at all.

## The system in motion

[`../flow/`](../flow/): three views, best read in this order. If you want the shape before the
detail, the same nine flows are written as one line each at the top of that folder's README:
[the nine flows](../flow/README.md#the-nine-flows-one-line-each).

| Diagram | Question it answers |
|---|---|
| [`WebFlow.pdf`](../flow/WebFlow.pdf) | What happens in the browser, from the first byte to data on screen |
| [`ServerFlow.pdf`](../flow/ServerFlow.pdf) | What happens to one request inside the BFF, in the order it runs |
| [`DataFlow.pdf`](../flow/DataFlow.pdf) | Where a number comes from and where it goes, with the trust boundary marked |

`ServerFlow` is the one to read before changing `index.ts`: the registration order of helmet, CORS,
the rate limit, compression, the error handler and the auth guard is the design, because a Fastify
hook only covers routes registered after it.

`DataFlow` is the one to read before touching the AI layer. In `hcml-portal` it carries a red box marked
*LEAVES THIS MACHINE*; in `hcml-portal-ollama` the same box is green and reads *STAYS ON THIS MACHINE*.

## The system at rest

| Where | What |
|---|---|
| [`../schema/`](../schema/) | Three one-page models, conceptual, logical, physical. What to hand someone |
| [`../erd/`](../erd/) | The exhaustive reference set: 46 entities across 9 domains, plus the 45 MySQL tables read from `information_schema` |
| [`../erd/erd.md`](../erd/erd.md) | The data model in prose, and the index to the three levels |

The gap between the logical and physical models is the project: every green entity, `SITE`,
`LINK`, `INCIDENT`, `HOST_AVAILABILITY` has nothing beneath it in the physical model, because the
portal owns no database ([ADR-0003](adr/0003-no-database.md)).

## The contract

[`../api/openapi.yaml`](../api/openapi.yaml), all 51 endpoints, both security schemes, every status
code and response schema. Checked against the code by `npx tsx tools/check/openapi.check.ts`, and against the web app's types by
`web/src/__tests__/openapiTypes.test.ts` (the types in `web/src/generated/openapi.ts` are made from it).

## The subsystems in prose

[`../../setup.md`](../../setup.md), 40 parts, one per subsystem and one for each day of changes. §1 is the big picture and §2
traces a request end to end: the same ground as `ServerFlow`, in words. **§§14 to 26 are the only
written record of how the derived figures are computed**; if you are changing the SLA engine, read §25
first.

## A note on the diagrams

They are Mermaid sources with committed PDF renders, and both folder READMEs carry a tested
`mermaid-cli` invocation plus the rules that were learned by breaking them: subgraph frames must be
unfilled or they paint over every edge; a bare `%%` becomes a *node* in a flowchart; the ELK layout
engine ignores per-subgraph `direction`.

**After editing a `.mmd`, re-render and check the picture, not the source.** Count that each lane
still reads in order and that no box has lost an edge.
