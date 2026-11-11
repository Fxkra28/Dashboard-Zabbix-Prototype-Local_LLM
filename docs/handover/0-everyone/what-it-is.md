# What the portal is

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Everyone | about 5 min | [Start here](../README.md) | [The pages, as questions](the-pages.md) |

> **Ringkasan**
>
> - Portal HCML adalah halaman web yang membaca data Zabbix milik HCML dan menampilkannya dengan lebih jelas.
> - Yang ditampilkan: masalah yang sedang terbuka, keadaan situs dan perangkat, grafik, laporan SLA bulanan, dan asisten untuk bertanya dengan bahasa biasa.
> - Portal hanya membaca. Satu-satunya yang ditulisnya adalah menandai masalah sebagai sudah diketahui atau menutupnya, dan hanya operator dan admin yang boleh.
> - Portal tidak punya database. Angkanya dihitung dari Zabbix saat diminta dan hilang ketika portal dimulai ulang.
> - Ada dua salinan portal: satu memakai Claude di internet untuk jawaban AI, satu memakai model di komputer sendiri sehingga tidak ada data yang keluar.

## In one paragraph

Zabbix is the system HCML uses to watch its network, its servers, its links and its web services. It records thousands of measurements and raises a problem when one of them goes wrong. It was built for engineers, and it answers the questions an engineer asks: what does this item say, what does this trigger do. The portal is a second window onto the same data, for the questions everyone else asks. Is anything wrong right now? Which site is in trouble? Was the link to that site up last month? It reads Zabbix, does the sums Zabbix does not do, and shows the result in words and figures a person can act on.

## What it adds to Zabbix

Zabbix has no idea what a site is. It has no idea what a WAN link is, or what to make of an outage that began before the month you are looking at. The portal works these out itself.

- It decides which of HCML's sites each device belongs to, from the device's tags, its name, its inventory record and its group, and it shows one card for each site.
- It treats the ping measurements of a link as one WAN path, with its packet loss and its response time, and pairs the path with its standby.
- It gives every device one state: up, down, degraded (answers ping while its other checks stay silent), no data, or disabled. Ping decides first.
- It works out the monthly availability of each device and of each site. HCML's Zabbix has no services or SLA set up, so the portal replays the history of problems to find out how many hours each device was reachable.
- It writes in words. A button explains a problem in plain language, and an assistant answers questions about the estate. A language model writes those words, and [data in and out](data-in-and-out.md) says what is sent to it.

## What it does not do

It does not watch the network. Zabbix does that, and when Zabbix stops collecting, the portal shows what Zabbix last had and says so. [Can I trust it](can-i-trust-it.md) explains how.

It does not send alerts. There is no email and no message from the portal when a problem appears. The one thing it can email is the monthly SLA report, to the people an administrator chooses, by hand or by itself on a day of each month, once email has been set up, and only in the copy that uses Claude.

It does not keep history of its own. There is no database behind it. What it knows, it asked Zabbix for a few seconds or minutes ago, and a restart makes it forget. The only things it keeps are its settings, its logs and, in the hosted copy, one small file with the people a report goes to, the monthly schedule and a record of the last 24 sends.

It does not change how Zabbix monitors. Nobody can add a host, edit a trigger or delete a template from it.

## The one thing it writes

An operator or an admin can mark a problem as acknowledged, and can close it, from the Problems page. That is the portal's only write. It goes to Zabbix with a message that carries the person's name, because Zabbix files every write under the owner of the token the portal uses and would otherwise not know who clicked. The portal logs each attempt, whether it worked or not, and the server accepts at most 50 problems in one request.

A viewer, and a wall screen, cannot do this at all. If the write is switched off for the whole portal, an operator sees a line that says so, and the control is not offered.

## Two copies

The portal exists twice, in two folders on the same machine, and the two are the same program. They differ in who writes the plain-language answers. One asks Claude, a model run by Anthropic on the internet. The other asks a model that runs on the machine itself, so nothing leaves it. The first is in the folder called hcml-portal and answers on port 8081. The second is in the folder called hcml-portal-ollama and answers on port 8082. Everything else, every page and every figure, is identical. [The two copies](../1-folders/the-two-copies.md) lists the differences for the person who has to keep them in step.

## Where it runs

It runs as two small programs, called containers, on a server that HCML controls. One serves the pages to the browser. The other talks to Zabbix. People open it in a browser at an address the operator gives them, and sign in. Before anyone outside that machine uses it, a secure connection (TLS) has to be put in front of it; the portal does not provide one itself.

## Why these pages exist

HCML set six goals for its monitoring: standard names and owners, monitoring by service rather than by device, deeper telecom visibility, alerts that carry context, dashboards for different roles, and automatic reports. Each page of the portal answers one of them. The next page lists the pages as the questions they answer, and the risks page says which goals are only partly met.
