# 10. Network monitoring (SNMP / ICMP)

[setup.md](../../setup.md) · previous: [§9](09-caching-strategy.md) · next: [§11](11-running-deploying.md)

The portal reads network gear exactly like any other host: it never speaks SNMP itself
(build brief `myown/documents/plan/instruct.md` §13). Zabbix's server/proxy polls devices; the portal reads
the resulting items:

- Availability: ICMP items `icmpping` (up/down), `icmppingloss` (%), `icmppingsec` (latency),
  merged per device in `/api/net/devices`.
- Ports/interfaces: SNMP LLD creates `net.if.in[...]`/`net.if.out[...]`, `ifOperStatus`, etc.;
  `/api/net/interfaces` reads them, and interface traffic graphs go through `/api/graph`.
- Onboarding is a later phase (the "network plug", §13.4): set `NET_GROUP_IDS` on the BFF and add
  devices in Zabbix. The network views populate automatically, no portal code change.
