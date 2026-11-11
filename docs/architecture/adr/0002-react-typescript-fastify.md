# React + TypeScript + Vite on the front, Fastify + TypeScript on the back

* Status: accepted
* Deciders: HCML internship project
* Date: 2026-09-04 (recorded as an ADR 2026-09-22)

## Context and Problem Statement

Having decided on a separate application ([ADR-0001](0001-bff-over-zabbix-api.md)), what should it be
written in? The answer has to survive a handover to whoever maintains it next.

**A note on provenance, because it matters for how much weight this ADR carries.** The stack is
written down in `myown/documents/plan/instruct.md` §2 as "fixed for this build", and that document was cited
during the project as though it were an external constraint. **It is not: it was written by this
project itself.** I chose the stack rather than inheriting it, so the reasons below have to stand on their
own rather than pointing at a brief.

## Decision Drivers

* One language across both halves, so types can describe the same shapes on each side.
* A large, boring ecosystem: this will be handed to someone who has not seen it before.
* Dense time-series charts render well and fast.
* Small dependency surface: every package is something to audit, update and explain.

## Considered Options

* React + TypeScript + Vite / Fastify + TypeScript
* Vue + Vite / FastAPI (Python)
* Plain PHP, matching Zabbix's own stack
* Next.js full stack

## Decision Outcome

Chosen: **React + TypeScript + Vite** on the front, **Fastify + TypeScript** on the back, **ECharts**
for charts.

TypeScript on both sides means a response shape can be written once and checked on both ends, and
in practice `web/src/types/` mirrors the server's types by hand, so the compiler catches drift on
the client even though nothing generates the mirror.

Fastify beat Express on its built-in hook lifecycle: the ordering of helmet, CORS, rate
limit, compression, error handler and auth guard is load-bearing here, and `onRequest` makes it
explicit rather than a matter of `app.use` call order.

### Positive Consequences

* The dependency surface stayed small: 7 runtime dependencies on the server, 5 on the web (8 on
  the server since the session cookie of ADR-0010).
* ECharts handles the dense series without a wrapper library.
* The hook ordering is visible in one file, `index.ts`.
* Vite's dev server makes the edit-reload loop immediate.

### Negative Consequences

* Two build toolchains to keep working, and two `node_modules` trees.
* **The type mirror is hand-maintained.** `web/src/types/` is not generated, and it has already
  drifted: in six places it declares a field optional that the server always sends. Since 19 October
  (FR-16) a test holds it to the OpenAPI file in one direction, which catches a page asking more of an
  answer than the file promises, and not these six places, nor a server that stops matching the file.
* A TypeScript/Node stack is a second language in a shop whose monitoring system is PHP. If HCML's
  team is PHP-first, this is a handover cost that was accepted rather than solved.
* ECharts is large. It is imported selectively to keep the bundle down, which is a rule someone has
  to keep following.

## Pros and Cons of the Options

### React + TypeScript + Fastify

* Good, because one language spans both halves.
* Good, because Fastify's hooks make the security ordering explicit.
* Bad, because it adds a Node runtime to an estate that otherwise runs PHP.

### Vue + FastAPI

* Good, because Python is more common in ops teams, and `zabbix_utils` is a maintained client.
* Bad, because it splits the codebase across two languages and two type systems.

### PHP, matching Zabbix

* Good, because it matches what HCML already runs and deploys.
* Bad, because the reason for the portal is that the PHP frontend is slow: 17 SQL statements for a
  login page. Rebuilding in the same stack invites the same shape.

### Next.js

* Good, because it is one framework instead of two.
* Bad, because SSR buys nothing for an authenticated internal dashboard, and it would pull in a much
  larger dependency tree for that nothing.

## Links

* Follows [ADR-0001](0001-bff-over-zabbix-api.md)
* `README.md` § Tech stack has the per-dependency justification
* `setup.md` §6 *Frontend: structure*, §23 *Hardening*
