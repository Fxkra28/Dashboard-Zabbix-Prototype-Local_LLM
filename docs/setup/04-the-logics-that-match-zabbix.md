# 4. The "logics" that match Zabbix

[setup.md](../../setup.md) · previous: [§3](03-zabbix-native-feature-mapping.md) · next: [§5](05-backend-file-by-file.md)

Beyond layout, the portal reproduces Zabbix's *semantics* so the numbers mean the same thing:

- Severity (`0..5`), Not classified → Disaster, using Zabbix's exact color palette
  ([`web/src/theme.ts`](../../web/src/theme.ts) `SEVERITIES`). Used everywhere as badges and count chips.
- Host availability: Zabbix 7.0 tracks availability per interface (`available`: 0 unknown,
  1 available, 2 unavailable). The portal rolls interfaces up to a host state (*worst wins*) in
  [`shared/lib/severity.ts`](../../web/src/shared/lib/severity.ts) `hostAvailability()`.
- Problem status & duration: `r_eventid !== '0'` ⇒ *Resolved*, else *Problem*. Duration is
  `recovery_time − onset` (or *now* if still open), matching Zabbix's "Duration" column.
- Acknowledgement: `acknowledged` flag surfaced as a pill and a filter.
- Item value types: `0` float, `1` char, `2` log, `3` uint, `4` text. Only numeric items
  (0/3) are offered for graphing; `history.get` is called with the matching `history` param.
- Interface types: `1` Agent, `2` SNMP, `3` IPMI, `4` JMX (shown on the Hosts page).
- Maintenance: `maintenance_status = 1` renders a "Maintenance" pill.
- Top-100 aggregation: mirrors Zabbix's report by counting `PROBLEM` events per trigger over a
  time window via `event.get`.
