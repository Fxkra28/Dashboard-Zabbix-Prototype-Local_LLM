# The desk card

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Operators | about 4 min | [Questions and terms](faq-glossary.md) | [Repository map](../1-folders/repository-map.md) |

> **Ringkasan**
>
> - Ini kartu satu halaman untuk operator di meja: di mana portal berjalan, bagaimana tahu portal hidup, dan apa yang dilakukan lebih dulu jika tidak.
> - Salinan Claude menjawab di port 8081 dan salinan model lokal di port 8082, pada mesin yang sama dan hanya dari mesin itu.
> - Jika halaman berkata "The data source is not answering", periksa jalur jaringan, sertifikat dan token. Jika Dashboard berkata Zabbix berhenti mengumpulkan, itu urusan tim IT HCML.
> - Jangan menaruh kata sandi, token atau berkas pengaturan di repositori, obrolan atau surel, dan jangan membuka portal ke mesin lain tanpa TLS.
> - Cetak halaman ini. Rincian ada di halaman folder, di runbook operasi, dan di bagian kerja sehari-hari.

Print this page. It is meant to fit on one sheet.

## Where it runs

Two portals on one machine. The copy that asks Claude answers on port 8081. The copy that asks a model on the machine answers on port 8082. Each is two containers, one that serves the pages and one that is the server. They answer only on the machine itself, until a secure connection (TLS) is put in front.

The machine must be on, signed in if it is a Mac, running Docker, and on HCML's office network.

## Is it up

1. Open the portal. The Dashboard says Live.
2. If it does not, read the notice at the top of the page.
3. Ask the watcher for its last state: it checks both portals every minute and records when one stopped answering.

## What you see, what it means, what to do first

| What you see | What it means | First move |
|---|---|---|
| The page does not load at all | The machine, Docker or the web container is down | Is the machine on, and is Docker running? Then look at the two containers and start the ones that stopped |
| Pages say "The data source is not answering" and quote a reference | The path, the certificate or the token to Zabbix | Is the machine on the office network? Did the certificate or the token change? |
| The Dashboard says Zabbix has collected nothing since a time | Zabbix stopped collecting | Tell HCML IT. Nothing to fix in the portal |
| The Dashboard says Zabbix cannot reach the network | Zabbix is cut off from the devices, so the down ones are probably not real | Tell HCML IT |
| The first visit to a page is slow | Normal after a start, until the portal has read its main views, which takes four to six minutes. Zabbix is slow on large questions | Wait. Later visits are fast |
| Explain says the AI is not answering | The model is down, or the hosted key is refused | The rest of the portal is fine. Check the model, or the key in the settings |
| Everyone is signed out | The sessions were ended, or the secret changed | Sign in again |
| One person cannot do something | Their role | Change the role in the settings and recreate the server container |

## After a restart

The containers start again by themselves when Docker starts. Then the portal reads its slow views once, which takes several minutes, and the first visits to those pages wait for it. Nothing false is recorded meanwhile, because Zabbix keeps collecting whether or not the portal is up.

## Never

- Never put a password, a token or the settings file in the repository, a message or an email.
- Never rebuild without a dry run first, and never delete the previous images before the new build has been checked. The rollback needs them.
- Never open the portal to other machines without TLS in front of it.
- Never sign a wall screen in as an operator.

## Who to ask

The owner of the portal: accounts, settings, backups, rebuilds, and anything the portal itself does. HCML IT: Zabbix, its certificate, its network path and the speed of its database.

## Where the details are

[Tools, deploy and docs](../1-folders/tools-deploy-docs.md) says what the watcher and the rebuild script do. [The two copies](../1-folders/the-two-copies.md) says how they differ. The runbooks are [after a restart](../../operations/after-a-restart.md), [backup and restore](../../operations/backup-and-restore.md) and [TLS](../../operations/tls.md).
