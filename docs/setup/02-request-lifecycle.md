# 2. Request lifecycle (a concrete example)

[setup.md](../../setup.md) · previous: [§1](01-the-big-picture.md) · next: [§3](03-zabbix-native-feature-mapping.md)

What happens when the Problems page loads:

1. React calls `api.problems()` → `fetch('/bff/api/problems')`. No token in the browser.
2. Dev: Vite's proxy rewrites `/bff/api/problems` → `http://localhost:4000/api/problems`.
   Prod: nginx reverse-proxies `/bff/` → the `portal-bff` container.
3. The BFF route checks its TTL cache (`problems`, 15 s). On a hit it returns instantly.
4. On a miss it calls `getProblems()` which:
   - calls Zabbix `problem.get` (raw problems, no host names),
   - collects the trigger ids, calls `trigger.get` with `selectHosts` once,
   - stitches `hostid` + host `name` onto every problem.
5. The enriched JSON is cached and returned to the browser.
6. React renders the table; a timer re-polls every 30 s, and the live stream makes the page read again at once when the list changes (§7).

This "call Zabbix, enrich, cache, serve a clean shape" pattern is the same for every endpoint.
