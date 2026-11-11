# 9. Caching strategy

[setup.md](../../setup.md) · previous: [§8](08-authentication.md) · next: [§10](10-network-monitoring.md)

- Each endpoint wraps its Zabbix call in `cached(key, ttlMs, fn)`.
- TTLs are tuned to how fast the data moves: problems 15 s, latest 15 s, availability 120 s, hosts 30 s,
  static-ish lists (groups, maps) 60 s.
- In-flight coalescing: if 10 browser tabs poll `/api/problems` at once during a cache miss, only
  one `problem.get` hits Zabbix; the rest await the same promise.
- The cache holds at most 500 entries and about 64 MB of values, least recently used first (§26).
- A key must not hold the second a request came in at, or two requests a few seconds apart never share an
  answer. A graph whose page gives an explicit `from` and `to` has them widened to whole minutes (`from`
  down, `to` up) after the range is checked as it was asked, so the two share one key, and the response
  says the widened range (`parseRange` in `services/history.ts`, BK-13).
- Scaling path: swap the in-memory `Map` for Redis (shared cache + SSE fan-out) without touching
  route code: the `cached()` signature stays the same.
