# What HCML provides

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Everyone | about 7 min | [Data in and out](data-in-and-out.md) | [Risks, limits and costs](risks-limits-costs.md) |

> **Ringkasan**
>
> - Portal bergantung pada HCML. Sebagian dari yang dibutuhkannya hanya bisa disediakan atau diputuskan oleh HCML.
> - Yang paling dasar: akun Zabbix hanya-baca beserta tokennya, jalur jaringan ke Zabbix, sertifikat Zabbix yang berlaku, dan sebuah mesin yang selalu menyala untuk menjalankan portal.
> - Kualitas isi portal mengikuti kualitas data di Zabbix: pengukuran ping, penamaan perangkat, tag situs, pemilik dan tingkat kepentingan, serta jendela pemeliharaan.
> - Halaman besar lambat karena server database Zabbix kekurangan memori dan diskinya sibuk. Hanya tim IT HCML yang bisa memperbaikinya.
> - Beberapa tujuan HCML baru tercapai sebagian karena menunggu keputusan atau pekerjaan di sisi HCML, misalnya data telepon dan radio, dan apa yang boleh dilihat tiap peran.

## What the portal depends on

The portal is a window onto HCML's Zabbix, so it is only as good as what Zabbix holds and only as reachable as Zabbix is. Some of what it needs only HCML can supply or decide. The table lists each need, what the portal does with it, and what you see when it is missing. Whether the portal gets a machine of its own or shares the one Zabbix runs on is compared in [Choices compared](../5-reference/choices-compared.md).

| HCML provides | What the portal does with it | If it is missing or wrong |
|---|---|---|
| A Zabbix account whose role can only read, and an API token for it | Every read, which is almost everything | Nothing loads. Pages say "The data source is not answering" and quote a reference number |
| A second, separate Zabbix token for writing | The one write, acknowledging and closing | The write is off, and operators see a line that says so |
| A network path from the machine that runs the portal to Zabbix's API | Every read | The portal starts, and its pages say "The data source is not answering" |
| A valid certificate for Zabbix's name, renewed in time | The portal checks the certificate and refuses to talk to a server it cannot verify | The portal stops reading. This happened once, when the certificate expired on 1 August 2026 |
| Ping measurements, and the two ping triggers, on every device | The state of each device, link health and the monthly availability | A device without them has no state, and its availability reads "No data" |
| Device names that follow HCML's convention, and tags for site, owner and criticality | Sites, device kinds and the inventory scorecard | The portal guesses the site from other signals, and the scorecard shows the gaps |
| A Zabbix dashboard with gauge widgets for the internet links (named Global view unless the settings say another name) | The internet traffic meters | The meters are empty or show a link as not available. A widget that points at an item that no longer exists shows as such |
| Planned maintenance entered in Zabbix as maintenance periods | Leaving planned work out of the monthly figure | Planned work counts as downtime |
| A database server for Zabbix with enough memory and a quiet disk | Speed of every large read | Pages are slow. See below |
| A machine that is always on and on the right network, with Docker | Running the portal | There is no portal |
| A secure connection (TLS) in front of the portal | Protecting passwords and sessions on the network | Passwords and sessions cross the network in the clear |
| A person who owns the portal | Accounts, settings, backups, rebuilds and watching it | Nobody notices when it stops |

## The read token should be read-only in Zabbix itself

The portal's code never writes with the read token, and it uses a different token for the one write. In the portal's code that separation holds. In Zabbix it did not yet hold when it was last checked, on 13 October 2026: both tokens belonged to a user whose role is Super admin. Creating a user with a read-only role, and giving the portal a token from that user, would make "the read token cannot write" true in Zabbix as well. It takes HCML a few minutes in Zabbix, and the role of the user behind the token now in use is worth checking first.

## The network path

From HCML's office network, the public name of Zabbix leads to a gateway that refuses the portal. So the machine that runs the portal is told that name means Zabbix's internal address, and the certificate is still checked against the name. That arrangement lives in a file on that machine, which stays out of the repository because it names an internal address. If HCML moves Zabbix, changes the gateway, or renews the certificate under another name, the person who runs the portal needs to be told, because the portal will say only that the data source is not answering.

Today the portals run on one developer's Mac on HCML's office network, which has to be signed in and awake. Running them on a server of HCML's own is the intended next step. The compose files have not yet been tried on a Linux server, and whoever tries them needs one.

## Why large pages are slow

HCML's Zabbix answers small questions in about a tenth of a second and large ones in tens of seconds. The cause measured on 29 October 2026 is its database server: the disk was busy 87 percent of the time all week, and the database programs used about 3 of 64 gigabytes of memory, with the database settings left at the defaults of the operating system. The portal now asks Zabbix for less and keeps what it reads, and it shows an older copy, saying how old it is, while a new one is built. What remains is Zabbix's own speed, and only HCML's IT team can change that. A request with the details is kept outside the repository.

The first visit to each page right after the portal starts is the slow one, until the portal has read its main views once, which takes four to six minutes (about four on 30 October, six on 2 November). On 30 October 2026, opening all 19 pages for the first time right after a start took about four and a half minutes in all, the slowest page about a minute. A few minutes later the same round took half a minute.

## Goals that wait on HCML

Two of HCML's six goals are only partly met because of something on HCML's side.

- Deep visibility of telephone and radio paths needs Zabbix to collect that data. It does not collect it today, so the portal has nothing to show.
- Dashboards for different roles need HCML to say what each role should see. The portal has four roles and one Dashboard with a wall version, and it can be given a different start page for each role once someone decides what each should be.

One other goal waits on work that is not yet done: alerts that join several triggers into one story. A report can already be emailed by hand, or sent by itself on a day of each month, once the portal has a mail account to send from (see the next section).

## A mail account, if the report is to be emailed

The portal sends the monthly report through a mail account it is given, and it logs in to that account with a name and a password. HCML's own mail is on Microsoft 365, where that kind of login is turned off by default for existing customers at the end of December 2026, though an administrator can turn it back on. So the portal cannot yet send through HCML's own mail. What it would need from HCML's Microsoft 365 administrator is a sending mailbox and an application registered for it, limited to that one mailbox. A way for the portal to use such an application is not built.

Until then the report can go out through another account, for example a Gmail account made for the portal. That is a choice for the owner, because the report names every device, and once it is in a mailbox the portal can no longer control who reads it.
