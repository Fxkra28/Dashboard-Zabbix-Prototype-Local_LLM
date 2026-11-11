# Can I trust it

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Everyone | about 8 min | [Who can do what](who-can-do-what.md) | [Data in and out](data-in-and-out.md) |

> **Ringkasan**
>
> - Semua angka di portal berasal dari Zabbix. Portal menambah hitungan dan kata-kata, bukan pengukuran. Kadang yang tampil adalah salinan lama, dan halaman berusaha mengatakannya.
> - Lencana Live di Dashboard berganti kata jika data terlambat, jika Zabbix berhenti mengumpulkan, atau jika Zabbix tidak bisa menjangkau jaringan. Pada keadaan terakhir, perangkat yang tampak mati kemungkinan besar tidak benar-benar mati.
> - Angka SLA bulanan dihitung portal sendiri dengan dua metode yang bisa memberi hasil berbeda. Metode ketat menghitung perangkat yang tidak menjawab sebagai mati. Metode laporan HCML hanya menghitung kehilangan ping yang tinggi.
> - Jika data terlalu sedikit untuk mengukur, angkanya ditulis "No data", bukan 0 persen dan bukan hijau.
> - Penjelasan dan jawaban AI ditulis oleh model dan bisa salah. Periksa di halaman yang bersangkutan sebelum bertindak.

## Where the numbers come from

Every figure on every page comes from Zabbix, through its API. The portal adds no measurements of its own. It adds arithmetic, such as how many hours of a month a device was reachable, and it adds words. So a number can be wrong in three ways: Zabbix collected the wrong thing, the portal's arithmetic is wrong, or the number is old. This page is about the third, and about how to read the second.

## How old can a page be

The portal keeps each answer for a while, because asking Zabbix is slow. HCML's Zabbix takes from a fraction of a second to several minutes to build an answer, depending on how much it must read. How long the portal keeps an answer depends on how costly it is to build, from seconds to hours.

| What | How old it can be | What the page does about it |
|---|---|---|
| The problem list and the Dashboard's live list | Fifteen seconds. The live connection sends a new list as soon as something a screen shows has changed, and the server signals at least every fifteen seconds that the line is still alive | Never shown from an old copy kept on purpose. If a refresh fails, the page keeps the last good list on screen and says how old it is |
| Views that are slow to build: Hosts overview, Devices, the Network and Maps pages, the internet meters, the busiest hosts, web monitoring, the SLA and the service pages | Up to ten minutes. The portal shows its last copy at once and reads a new one in the background | Once the copy is two minutes old, a line says "Data from 08:48 (12 min ago); a newer copy is being read from Zabbix." Younger than two minutes, it says nothing, because it is no older than Zabbix's own data |
| The Availability and Alert noise reports | Kept for two minutes, then the previous run is shown for two more minutes while a new one is built | The page says how old the copy is |
| The Capacity report | Kept for an hour, then the previous run is shown for up to a day while the next one is built, because a run takes minutes on HCML's Zabbix | The page says how old the copy is |
| Any of those reports when Zabbix fails | The last copy the portal kept, however old | The SLA, Availability, Capacity and Alert noise pages say "Zabbix did not answer, so this is the last copy the portal kept, from 08:48 (1 h 12 min ago)." |

The times in those lines are examples. The page works the real ones out.

## The Live badge

The Dashboard shows a badge next to its list, with the time of the last update beside it. Its wording says what you are looking at.

| The badge says | What it means |
|---|---|
| Live | The live connection is open. A new list arrives when anything changes |
| Polling | The live connection is not in use, so the page asks again from time to time. "Polling: live stream error" means the connection dropped, and the page reopens it by itself |
| No new data for 3 min | Nothing has arrived for more than ninety seconds. The badge turns to a warning, because a quiet screen otherwise looks exactly like a quiet network |
| Zabbix has collected nothing for 20 min | Zabbix's server has stopped collecting while its API still answers, so every value on the page is from before |
| Zabbix cannot reach the network | Almost no device answers its ping. Zabbix's way into the network is cut, and the devices it calls down and the problems it raises are most likely not real. The notice says how many devices answered |

The last two exist because a Zabbix that has stopped collecting, or has lost its way into the network, looks exactly like a quiet network. The second of them was added after a day when a copy of Zabbix recorded five hours of outages that never happened, after the machine it ran on left HCML's network. Nothing was wrong with the network, and the figures said otherwise. The portal now recognises that pattern and says so on the Dashboard, and a setting lets the operator mark such hours as no data in the monthly figure.

## The monthly figure

HCML's Zabbix has no services or SLA configured, so the monthly availability is the portal's own work. It replays the history of the ping problems of every device and adds up the time each one was reachable. The SLA page says so in a banner.

It shows two figures, because two methods are in use.

- The strict method counts a device that does not answer as down. It leaves out the hours when nothing was collected, since a gap is not evidence either way.
- HCML's report method counts only high ping loss. A device that is completely down is a device with no ping to lose, so under this method it still counts as up.

The two also differ in the hours when nothing was collected. The strict method leaves those hours out, and a device with too little data gets no figure. HCML's method counts them as up, and a device that was never measured counts as fully available. That is why the same device can read No data in one figure and 100 percent in the other.

Both are shown because HCML's own published reports use the second one, and the portal was built to reproduce them. The check is made against HCML's monthly Availability Reports, with tolerances for the figure of each category, each device and the number of incidents. It is run by hand with spreadsheets that only the owner holds. They answer different questions. The strict one asks whether the device was reachable. The other asks whether the ping loss was high. It is the one that matches HCML's reports. When they differ, the note on the page says why.

Planned maintenance windows that Zabbix knows about are left out of both methods.

When too little data was collected to measure a device or a month, the figure is a grey "No data". It is never printed as 0 percent, and never green or red. A figure that misses the target is also never rounded up to the target: 98.996 against 99 does not print as 99.00.

## When a count differs from Zabbix's own screen

Four reasons cover nearly every case. The portal may be showing a copy that is up to fifteen seconds old, so look at the time beside the badge. The portal leaves out of its counts a problem that Zabbix has suppressed because it began during planned maintenance, and a problem that has been solved but that Zabbix still lists for a few minutes, and Zabbix's own screen can show both. A filter may be on in one of the two screens. And the Dashboard's live list shows only the twelve worst problems, so a count of its rows is not a count of problems. When the figures matter, open both screens at the same moment and compare the time beside each.

## When a model writes the words

Explain and the Assistant are written by a language model, and a model can be wrong. The portal narrows the risk in several ways. The model is told to use only what it is given and not to invent a device, a number or a cause. It has no tools, so it cannot look anything else up and cannot change anything. It answers from a summary of the estate that the portal builds from its cached reads (it reuses one for up to five minutes while nothing it describes has changed), and when the summary had to be cut to fit, the page says "partial view". Counts over every open problem are put into the summary as counted facts, so the model does not have to count a list.

Even so, the footer of the Assistant says to confirm on the relevant page before acting, and that advice stands. A small model run on the machine itself has less room for a long list, which is why the portal does the counting for it. Neither kind is a source for a decision. An explanation of a problem is kept for an hour, and an explanation of an SLA figure for five minutes, so the words can be up to that old.

## A short check before you rely on a number

1. Look at the badge and at the time beside it. Is it live, and is it recent?
2. Look at the top of the page for a notice about Zabbix.
3. For an SLA figure, see which method it is, and whether it says "No data".
4. For anything a model wrote, open the page it talks about and confirm.
5. If the number will go into a report or a decision about a customer, open the same figure in Zabbix.
