# Open problems, and the hole each one leaves

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Everyone | about 6 min | [What is still open](open-items.md) | [Glossary](glossary.md) |

These are the problems that only HCML and the owner of the portal can still close: nine for HCML and eleven for the owner, as of 16 November 2026. Each row gives the category, the problem, and the hole it leaves if nothing is done. [What is still open](open-items.md) lists every unfinished row with its tracker number, including the one that the assistant can do once the owner says so.

## What only HCML can close

<!-- rows: SC-23 SC-41 SC-42 IN-41 IN-25 IN-56 IN-57 IN-58 IN-60 -->

| Category | The problem | The hole it leaves |
|---|---|---|
| Access to Zabbix | Both Zabbix tokens that the portal uses, the one that reads and the one that writes, belong to users with the Super admin role, which allows every method. The portal reads only with the read token, but the token itself could do more. | Anyone who got hold of the read token could change HCML's Zabbix, not only read it. |
| Signing in | There is no second sign-in factor. Users are names and passwords in the settings file. | A guessed or stolen password is enough to see HCML's estate. |
| Logs | Where the container logs go after a rebuild, and for how long they are kept, has not been decided. The server keeps its own copy in a volume and the rebuild script saves another, but both are on the same machine. | If the machine is lost, nobody can later say who used the AI or who downloaded a report. |
| Speed | Zabbix's database seems to run on MySQL's defaults, a 128 MB cache for about 20 GB, so large reads took 37 to 256 seconds. | Pages that read a lot are slow, and each big read loads HCML's Zabbix. |
| First install | Nothing has run on a Linux server yet. The tests ran in a Linux container. The local-model copy reaches Ollama from inside its container, so Ollama has to be set to listen where the container can reach it. | The first real install may fail in ways nobody has seen. Ollama has no sign-in, so one set to listen on every address would be open to the whole network. |
| Zabbix upgrades | No Zabbix upgrade has been tried, and there is no test Zabbix to try one on. The portal reads names that an upgrade can change. | After an upgrade a page can go empty or wrong, and there is nowhere to find out first. |
| Load | The load of a normal day on HCML's network has not been measured. The only figures are from one Mac on 29 and 30 October. | How much the portal asks of Zabbix with many screens open is a guess. |
| Mail | HCML's own mail is on Microsoft 365, which turns off the login by name and password by default at the end of December 2026. The portal can only log in that way, and the sender it would need instead is not built. | Reports cannot go out from an HCML address, and the password login may stop working. |
| Moving to the server | The saved recipients, the schedule and the record of sends are one small file on a Docker volume on the owner's Mac, and the monthly send depends on a laptop that sleeps and is often off HCML's network. | If the Mac is off or the volume is lost, the monthly report is late or has to be set again, and one month could go twice. |

## What only the owner can close

<!-- rows: SC-01 SC-06 SC-30 IN-08 IN-30 SC-33 IN-43 IN-50 IN-24 IN-61 IN-62 -->

| Category | The problem | The hole it leaves |
|---|---|---|
| Data leaving HCML | The hosted copy sends host names, trigger text, tags and a summary of the estate to Anthropic on every Explain click and every Assistant question. Whether its outside model stays on is the owner's decision. | While it is on, HCML's data leaves the network each time someone uses the AI. |
| Public repository | The public history of the first copy holds a secret from its first commit. History cannot be unpublished, so the fix is to revoke the secret where it was issued. | Anyone can read the secret in the history, and it keeps working until it is revoked. |
| Public repository | The licence is all rights reserved, which is the safe default. GitHub's private vulnerability reporting is not switched on yet, and only the owner can switch it on. | Someone who finds a flaw has no private way to report it. |
| Local-model repository | The local-model copy has been a repository since 11 November with a remote of its own. Nobody has recorded whether that remote is private. | Nobody can say who can read its code and documents. |
| Checks on GitHub | The checks have never run on GitHub, because the account has a billing lock, and 15 pull requests from Dependabot, the update bot, are open. | The image builds, the nginx check, the package audit and the secret scan are untested there, and the package fixes wait unmerged. |
| HCML's name in files | HCML's real Zabbix host name is written in 14 files that are not committed. It is public DNS, and it is not in the public history. | Committing the files would put HCML's real address in a public repository, so the owner and HCML have to decide first. |
| Restarts | After the Mac restarted on 31 October, Docker Desktop did not open and both portals were down for about 37 hours. Docker's start-at-sign-in setting was found off on 11 November. | After any restart, such as a power cut or an update, the portals stay down until someone opens Docker Desktop. |
| Backups | A copy of both source trees, without the settings files, is on the Mac's own disk. Nothing backs up the Mac itself, because Time Machine has no drive. | A lost disk loses everything that is not committed and pushed, including the settings files. |
| Backups | The settings files hold the sign-in password, the signing secret, both Zabbix tokens, the Anthropic key and the Gmail login. No encrypted copy exists yet. A helper script is ready for the owner to run with a passphrase. | If the Mac fails, the users, the roles and every token go with it and have to be made again. |
| Monthly report | The monthly email is built and not switched on: no schedule and no list of people are saved. Nothing goes on 1 December until an administrator sets it. | The report that was asked for does not go out. |
| Report in spam | The first two reports, sent through a new personal Gmail account, landed in the recipient's spam folder. Each recipient can allow the sender. For good, the reports need a sender on HCML's own domain or a mail service. | People may never see the report, or see it late. |
