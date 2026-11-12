# Risks, limits and costs

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Everyone | about 6 min | [What HCML provides](what-hcml-provides.md) | [Questions and terms](faq-glossary.md) |

> **Ringkasan**
>
> - Risiko terbesar adalah ketergantungan: portal hanya secepat dan semutakhir Zabbix. Halaman besar lambat pada kunjungan pertama setelah portal dimulai.
> - Saat ini portal berjalan di satu mesin pada jaringan kantor HCML. Jika mesin itu mati, tidur atau keluar dari jaringan, portal tidak bisa membaca Zabbix. Pemantauan Zabbix sendiri tidak terganggu.
> - Portal tidak bisa mengumpulkan data, tidak mengubah pemantauan, tidak punya riwayat sendiri, dan tidak bisa melihat lebih jauh dari masa simpan Zabbix.
> - Biaya nyata ada pada token AI (salinan Claude, dengan batas harian), mesin yang menjalankannya, dan waktu orang yang merawat dua salinan.
> - Beberapa hal masih terbuka dan daftar lengkapnya ada di tracker, termasuk kunci AI yang ditolak, repositori yang masih publik, dan salinan kedua yang belum memakai kontrol versi.

## What can go wrong

| Risk | What you would see | What reduces it |
|---|---|---|
| Zabbix is slow, because its database server is starved | Pages that take from several seconds to a few minutes on their first visit after the portal starts | The portal asks for less and keeps what it read. The real cure is on HCML's side: [what HCML provides](what-hcml-provides.md) |
| Zabbix stops collecting | The Dashboard says Zabbix has collected nothing since a time. Every figure is from before | The badge and the notice say so. Zabbix itself is the thing to fix |
| Zabbix is cut off from the network | Devices look down and problems pile up although nothing is wrong | The Dashboard says Zabbix cannot reach the network, and how many devices answered |
| The portal cannot reach Zabbix | Pages say "The data source is not answering" and quote a reference number | Check the network path, the certificate and the token |
| The machine that runs the portal stops | There is no portal. Zabbix and its alerts carry on, because the portal sits beside them and not in front | A watcher script can tell someone when a portal stops answering. The machine has to be always on |
| A secret leaks | Someone can read Zabbix, or forge a session | The settings file is not in the repository and is mode-restricted. Each copy signs sessions with its own secret. Change a leaked token at its source and then in the settings |
| The settings file is lost | The portal does not start | Keep an encrypted backup of it. Nothing else holds a copy |
| The model gives a wrong answer | A confident sentence that is false | The model sees only a summary and has no tools. The page tells you to confirm before acting. See [can I trust it](can-i-trust-it.md) |
| The monthly figure is read as more exact than it is | Two methods that differ by a little, or a "No data" | The page names the method and the gaps |

## What it cannot do

- It cannot collect anything. Zabbix collects. If Zabbix does not measure a thing, no page can show it.
- It cannot change how monitoring works. It can acknowledge and close a problem, and nothing more.
- It remembers almost nothing. Everything it works out is gone when the server restarts, it keeps no saved views, and it keeps no history of who did what other than the note in Zabbix, the server's log and, for the report email, the name of whoever sent it or set the schedule in the small state file. A closed month's figure is worked out again after each restart. The one thing it keeps is a small file in the hosted copy: the people a report goes to, the monthly schedule and a record of the last 24 sends (the oldest manual one goes first).
- It cannot see further back than Zabbix keeps. HCML's policy keeps raw measurements for about a month and hourly averages and events for a year, so a question about two years ago has no answer through this route.
- It cannot send an alert. The only email it can send is the monthly SLA report, and short notices about a monthly send that failed, was missed or was partly refused, to the people an administrator chooses, when an administrator presses a button or has set the monthly send, and email has been set up.

## What is still open

The complete list, with the state of each row, is [the tracker](../../../tracker.md). These are the items a non-developer should know about, as of 10 November 2026.

- **Goals only partly met.** Telephone and radio path monitoring waits on Zabbix collecting that data. Dashboards by role wait on HCML saying what each role should see. Alerts that combine several triggers are not built. Reports by email, by hand or on a monthly schedule, are built; the schedule has not run on a real first of the month yet, and HCML's own mail cannot be used until its Microsoft 365 administrator helps. See [what HCML provides](what-hcml-provides.md).
- **The hosted AI key.** The key that the running hosted copy holds was refused by Anthropic on 16 October 2026, so Explain and the Assistant of that copy answer nothing until a valid key is put in its settings. The local-model copy is not affected.
- **The repository is public.** Anything committed to it is public. An old Zabbix token sits in its history. If it still works anywhere, it has to be revoked there, since history cannot be unpublished. Whether the repository should be private is the owner's decision.
- **The second copy's history starts on 11 November 2026.** It became a git repository of its own that day, and everything it held before exists on one disk. Whether its remote is public or private is the owner's to say (IN-08).
- **Not yet tried on a Linux server.** The compose files have not been tried on a Linux server. See [what HCML provides](what-hcml-provides.md).
- **Checks on GitHub have never run.** The workflow is written and passes on the developer's machine. The account that hosts the repository has a billing lock, so no run has started there.
- **A Zabbix database that needs tuning.** Only HCML's IT team can do it.

## What it costs

**Money.** The portal itself is free to run. The costs outside it are the machine, which has to be on all the time, and the model, if the hosted copy is used. A hosted model charges by the amount of text it reads and writes. The portal limits each person to ten questions a minute and, by default, to half a million tokens a day each and two million in all, where a token is the unit a model is billed by, so a bill cannot run away unnoticed, though the daily limit is set by the portal's settings and not by the provider. The local-model copy has no bill. It needs a machine with enough memory to hold the model.

**Load on Zabbix.** The portal only reads, and it was built to ask for little. It reads the problem list every fifteen seconds while a Dashboard is open, and the larger views once and then from memory. Zabbix's own checks and alerting are not affected by the portal being on or off.

**People.** The portal needs an owner: someone who keeps the settings and the accounts, backs up the settings file, watches that it is up, and rebuilds it after a change. A change to the code has to be made twice, once in each copy, and each rebuild takes several minutes. The checks that run before a change goes live take about five minutes.
