# Questions and terms

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Everyone | about 10 min | [Risks, limits and costs](risks-limits-costs.md) | [The desk card](one-page-ops-card.md) |

> **Ringkasan**
>
> - Halaman ini menjawab pertanyaan yang paling sering muncul: kenapa halaman lambat, kenapa angka berbeda dari Zabbix, kenapa tombol tidak ada, dan siapa yang bisa mengubah akun.
> - Jawabannya pendek dan mengarah ke halaman yang menjelaskan lebih lengkap.
> - Bagian kedua adalah daftar istilah: istilah Zabbix seperti host, item, trigger dan problem, serta istilah portal seperti situs, jenis perangkat, meter dan metode ketat.
> - Setiap istilah dijelaskan dengan bahasa biasa, tanpa kode.
> - Jika pertanyaan Anda tidak ada di sini, tanyakan kepada pemilik portal dan sebutkan halaman, waktu, dan angka yang Anda harapkan.

## Questions

### Using the pages

**Why is a page slow the first time I open it?** The portal asks HCML's Zabbix, and Zabbix is slow on large questions. The first visit after the portal starts has to wait for the answer. Later visits are served from memory, and the page tells you how old the data is when it is more than a couple of minutes old. [What HCML provides](what-hcml-provides.md) has the measured times.

**Why does a number differ from what Zabbix shows?** Four reasons are common. The portal may be showing an older copy, so look at the time beside the badge. The portal leaves out of its counts a problem that began in planned maintenance and a problem that is already solved, which Zabbix's own screen can still show. The portal may be working out something Zabbix does not, such as the state of a device (ping decides first) or the monthly availability. Or a filter is on in one of the two screens. [Can I trust it](can-i-trust-it.md) goes through them.

**What does "No data" mean next to an SLA figure?** Too little data was collected to measure. It is deliberately not a percentage, because a figure of 0 would say the device was down and a figure of 100 would say it was fine, and neither is known. HCML's own method does not do this: it counts a device that was never measured as fully available, which is one reason the two figures can differ.

**Why do I see two SLA figures?** The strict method counts a device that does not answer as down. HCML's report method counts only high ping loss. HCML's published reports use the second, so the portal shows both.

**Why does a problem I just acknowledged still look open?** Zabbix takes a few seconds to apply the change. For up to about a minute the row says that it was sent and that the portal is waiting for Zabbix.

**Why can I not see the Network page?** It needs the wall role or a higher one. Ask the operator. [Who can do what](who-can-do-what.md) lists the roles.

**Why is there no Explain button?** Either the portal has no model to ask, or the model is not answering. A line at the top of the page says so when it is the second. The rest of the portal is not affected.

**Where does a device's site come from?** The portal decides it from four signals, strongest first: an explicit site tag, the device's name, its inventory record and its host group. The Sites page shows which signal decided each device. The more devices carry an explicit tag, the fewer guesses the portal makes.

**Can I download the monthly report?** Yes, as a PDF to print or send or as an Excel file to sort and total. Both buttons are on the SLA page. The Availability page offers them when the period is one calendar month on the strict basis. The files list every device by name, so treat them as estate data: they are never put in the repository.

**Can I use it on a phone or a tablet?** The pages adapt to a narrow screen, the menu shrinks to a strip, and controls are made large enough to touch where the pointer is a finger. The portal is designed for a desk and a wall.

**Does it work without the internet?** The portal needs the network between it and Zabbix, and nothing else. Only the copy that uses Claude needs the internet, and only for Explain and the Assistant. The fonts are served from the site itself.

**Can the page be dark?** Yes. The theme is light, dark, or the computer's setting, and the choice is kept in your browser.

### Accounts and sessions

**How do I get an account, or a different role?** Ask the person who runs the portal. There is no page for it, because accounts are part of the server's settings.

**Why was I signed out?** A session lasts twelve hours by default. The operator can also end every session at once. Sign in again.

**Who can see what I do?** The server's log records each request with the address it came from, and each acknowledgement with your name. Zabbix keeps your name in the note on an acknowledgement. The Assistant conversation stays in your tab and is cleared when you sign out or close it.

### The model

**Is it safe to ask the Assistant about real devices?** In the copy that uses Claude, the question and a summary of the estate go to Anthropic, and the page says so under each answer. In the other copy nothing leaves the machine. [Data in and out](data-in-and-out.md) has the detail.

**Can the Assistant change something?** No. It has no tools. It reads a summary and writes text. Acknowledging is done on the Problems page, by an operator.

**Can I trust what it says?** Treat it as a quick read, and confirm on the page it refers to before you act.

### Running it

**Can the portal break Zabbix?** It cannot change monitoring, and it reads little and keeps what it read. A heavy report can load Zabbix's database for some seconds, which is why the portal runs at most two such reports at once. Zabbix's own checks and alerts carry on whether the portal is up or not.

**How do I know it is up?** The Dashboard says Live. For the machine, a watcher script checks every minute and says when a portal stops answering. The operator knows where it runs.

**What has to be backed up?** The settings file on the server: the accounts, the tokens and the secrets. It is not in the repository and nothing else holds a copy.

**Who do I tell about a wrong figure?** The owner of the portal. Say which page, what time, what you saw and what you expected. If the page showed an old copy, say that too.

## Terms

### Zabbix

| Term | What it means |
|---|---|
| Zabbix | The monitoring system HCML uses. It measures things and raises problems. The portal reads from it |
| Host | One monitored thing in Zabbix: a switch, a firewall, a server, a web service. The portal says device when it means the same |
| Host group | Zabbix's way of grouping hosts |
| Item | One measurement on one host, such as the reply time of a ping, the traffic of a port or the load of a processor |
| Trigger | A rule over measurements that raises a problem when it is true |
| Event | A trigger changing state: a problem starting, and later ending |
| Problem | An event that has started and not yet ended |
| Severity | How serious a problem is. Zabbix has six levels: Not classified, Information, Warning, Average, High and Disaster |
| Acknowledge | To tell Zabbix that someone has seen a problem and is dealing with it. The problem stays open until it is resolved or closed |
| Tag | A label on a host or a trigger, such as the site, the owner or the criticality |
| Template | A set of items and triggers that Zabbix applies to many hosts at once |
| History | The raw values Zabbix collected. HCML keeps about a month of them |
| Trend | The hourly lowest, average and highest of an item. HCML keeps a year of them |
| Maintenance | A planned period in which a host's problems are suppressed |
| Web scenario | A check that fetches a web page or a series of pages and reports whether it worked |
| Zabbix agent | A small program on a server that reports measurements to Zabbix |
| Ping, ICMP | The simplest test of whether a device answers: send a small message and wait for the reply |
| SNMP | The standard way to ask network devices for their state and the traffic of their ports |
| API, API token | The way one program asks another for data, and the key that proves it may. The portal uses Zabbix's API with a token |

### The portal

| Term | What it means |
|---|---|
| Site | One of HCML's locations. Zabbix has no such thing, so the portal decides each device's site from its tag, its name, its inventory record and its group |
| Device kind | One of eight: switches, firewalls, access points, radio repeaters, servers, WAN links, web services and other |
| Host state | The portal's own call on a device: up, down, degraded, no data or disabled. Ping decides first. Degraded means it answers ping while its other checks stay silent |
| Link, WAN path | A connection between sites, with its packet loss and response time, paired with its standby |
| Meter | A dial for one internet link, showing its traffic against its capacity |
| Wall screen | The Dashboard drawn for a screen nobody can click: it turns between its views by itself and fits the window |
| Live badge | The label on the Dashboard that says whether the page is live and how recent its data is |
| Old copy | An answer the portal kept earlier and shows again, usually while it reads a new one or because Zabbix failed. The page says how old it is |
| Explain | The button that writes a problem or an SLA figure in plain words |
| Assistant | The page where you ask questions about the estate in plain words |
| Summary, snapshot | The text the portal builds from the estate to give the model with a question. It is cut to a size the model can read, and the page says "partial view" when it was cut |
| Model | The language model that writes the plain-language answers. One copy of the portal asks Claude over the internet. The other asks a model on the machine |
| SLA, SLI, target | The service level agreement is the promise. The service level indicator is the measured figure. The target is the figure promised, by default 99 percent |
| Strict method | The monthly availability counting a device that does not answer as down and leaving out hours with no data |
| HCML report method | The monthly availability counting only high ping loss, which reproduces HCML's published reports |
| Coverage | How much of a period a measurement was actually collected |
| Incident | A problem paired with its recovery, trimmed to the period being reported on |
| Alert noise | Alarms not worth sending. Flapping, unactioned and chronic are its three flags |
| Scorecard | The page that measures how complete the records are: naming, site, owner and criticality |
| Role | What an account may do: viewer, wall, operator or admin |
| Session | The time you stay signed in. Twelve hours by default |

### Running it

| Term | What it means |
|---|---|
| BFF | Backend for frontend. The server part of the portal. It sits between the browser and Zabbix, holds the tokens and keeps the copies |
| Container, Docker | A packaged program, and the tool that runs it. The portal is two containers: one serves the pages, one is the server |
| Settings file | The file on the server that holds the accounts, the tokens and the secrets. It is the one thing to back up |
| TLS | The secure connection behind the padlock in a browser. The portal does not provide it, and has to have it put in front of it |
| The two copies | The portal in two folders: one asks Claude, one asks a model on the machine. The code is the same |
| Rebuild | Making new containers from the current code. It is how a change goes live |
| Rollback | Going back to the containers from before the last rebuild |
