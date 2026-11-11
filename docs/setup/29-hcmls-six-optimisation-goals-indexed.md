# 29. HCML's six optimisation goals, indexed

[setup.md](../../setup.md) · previous: [§28](28-glossary.md) · next: [§30](30-what-changed-on-12-october-2026.md)

*Reconstructed 22 September 2026. `DOCUMENTATION.md` opened with this framing. The mapping itself was
never lost (it is spread across `setup.md` §3 and the openers of §§14 to 21) but there was no single
index, and that absence is what made it feel gone.*

> *"From basic monitoring toward a consistent, measurable system that supports operational
> decisions."* Target outcome: faster detection · more relevant alarms · shorter troubleshooting ·
> more credible reporting.

| Goal | HCML's stated gap | Where the portal answers it | State |
|---|---|---|---|
| 1 · Standardization | Naming, site, owner and criticality are not standardized, so alarms are hard to route to the right person | Inventory & ownership scorecard, §16. Site coverage in §14 is the measure of progress | met |
| 2 · Service-based monitoring | Device-centric, not service-centric, *HCML's stated core problem* | Services tree, §15, plus the derived SLA in §25 at the real 99 % target | met |
| 3 · Telecom deep visibility | Voice, radio and SIP path monitoring incomplete | Link & WAN health, §17; the Dashboard's Internet traffic meters ([ADR-0012](../architecture/adr/0012-internet-meters-from-the-zabbix-dashboard.md)) | partial, SIP and UHF/VHF are blocked on Zabbix-side collection, out of scope since 2026-09-07 |
| 4 · Smart alerting | Notifications lack context, correlation and escalation | Alert-noise and flapping, §21; the plain-language layer, §13 | partial, cross-trigger correlation not built |
| 5 · Role-based dashboard | Dashboards not tailored to NOC, engineers, management | Site view §14, RBAC §19, the Dashboard's three views and the wall screen (§33 to §35) | partial, role-scoped landing pages need HCML to define what each role sees |
| 6 · Automated reporting | Hard to see SLA, capacity trends and recurring issues | Availability, capacity, aging and top-triggers, §18; derived SLA §25; the monthly SLA report as a PDF, Excel or CSV download, emailable by an administrator and sent by itself every month, §18 | partial: the export, the email and the monthly send are built; HCML's own mail (Microsoft 365) and a real first of the month are not proved |

Two met, four partial. Two of the partial goals wait on someone outside the portal: Goal 3 needs
Zabbix to collect SIP and UHF/VHF data it does not collect today, and Goal 5 needs HCML to say what
each role should see. The other two are code and proof: cross-trigger correlation
(Goal 4) is not written, and the monthly report of Goal 6 is written but has not run on a real first of the month.

§3's table *"Six things have no Zabbix equivalent"* carries the same mapping per feature, and is the
better place to start if you are asking "why does this page exist?" rather than "is this goal done?".
