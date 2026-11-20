# Data in and out

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Everyone | about 10 min | [Can I trust it](can-i-trust-it.md) | [What HCML provides](what-hcml-provides.md) |

> **Ringkasan**
>
> - Portal membaca data hanya dari API Zabbix milik HCML, dan hanya menulis satu hal: tanda sudah diketahui atau penutupan sebuah masalah.
> - Portal tidak menyimpan data jaringan. Yang tersimpan hanyalah berkas pengaturan (administrator pertama, token, ambang batas), catatan log, dan, pada kedua salinan, satu volume kecil berisi akun halaman Users, daftar penerima, jadwal bulanan dan catatan pengiriman terakhir (tanpa alamat).
> - Pada salinan yang memakai Claude, teks masalah, angka SLA atau ringkasan kondisi jaringan dikirim ke Anthropic hanya ketika seseorang menekan Explain atau bertanya ke Asisten, dan halaman menyebutkannya di bawah jawaban.
> - Pada salinan yang memakai model lokal, tidak ada data yang keluar dari mesin. Font juga disajikan dari situs sendiri.
> - Kata sandi, token dan kunci tidak pernah dikirim ke peramban maupun ke model.

## What comes in

The portal reads from one place: the API of HCML's Zabbix. Through it the portal asks for hosts and host groups, measurements and their history and hourly averages, triggers, problems and events, maps, the services and SLA objects Zabbix has (HCML has none), web scenarios, the planned maintenance windows, and the Zabbix dashboard HCML keeps for its internet links. It makes no other connection for data. There is no second system, no spreadsheet feed and no database that it reads.

It signs in to Zabbix with a token. A read token does all the reading. A second, separate token does the one write, and when it is not set, the write is off. The tokens live in the portal's settings file on the server and are used only by the server. Neither is ever sent to the browser.

## What goes out to Zabbix

One thing: an acknowledgement or a closing of a problem, with a message that carries the name of the person who clicked. See [what the portal is](what-it-is.md) and [who can do what](who-can-do-what.md).

## What is kept, and where

| Where | What it holds | For how long |
|---|---|---|
| The server's memory | The answers it got from Zabbix, so the next person does not wait | From seconds to a day, depending on the answer. All of it is lost when the server restarts |
| The server's settings file | The first administrator and any account listed there (the others are copied to the users file at the start), the Zabbix tokens, the model key, the secret that signs sessions, thresholds and targets | Until someone edits it. It is not in the repository, and it is backed up by hand, together with the state volume below |
| The server's logs | Each request with an id (the health check's are left out), the address it came from and its result. Each sign-in. Each acknowledgement, with the person's name and address. Each use of the AI and each report download or email, with who did it, what kind and how it ended, and never the question, the answer, a file or an address. A token in an address is hidden before it is written | Docker keeps up to five files of fifty megabytes for each container, overwrites the oldest, and deletes them when the container is made again. The server also keeps its own copy in a store that a rebuild leaves alone: up to ten files of twenty megabytes, the oldest dropped first |
| The logs the rebuild script saves | Before the rebuild script replaces a container it saves that container's log, compressed, one file for each copy and each rebuild. They are the same lines as the server's logs above, so they hold the account names that signed in, and the addresses | The newest 30 of each copy, in a folder under the home folder of the person who runs the script, kept until a later rebuild trims them or someone deletes the folder. [Backup and restore](../../operations/backup-and-restore.md) names the folder and the setting for the number |
| The watcher's folder | The last state of each portal and container the watcher script checks, the time of its last run, and a log of what it told someone: portal addresses and container names, and no estate data | A folder under the home folder of the person who runs it, which [the full-disk page](../../operations/full-disk.md) names. The log is never trimmed: it grows only when something changes |
| The `portal-state` volume | The saved addresses, the monthly schedule and a record of the last 24 sends, with counts and no address in the record. The web check figures of months that have closed. The people who can sign in, each with a role, the pages they may open and a scrambled hash of the password, never the password | Until someone deletes the volume. No backup holds it unless it is copied out by hand, and a copy that holds the hashes is kept like a secret |
| The browser | A session cookie that the scripts on the page cannot read. The theme and whether the menu is collapsed. The Assistant conversation, in that tab only | The cookie until the session ends. The choices until the browser is cleared. The conversation until the tab closes or the person signs out |

Nothing else is stored. There is no analytics, no tracking and no report back to anyone: the page is allowed to contact only its own site, and the fonts are served from that site too, so a visit fetches nothing from outside.

## What leaves HCML's network

This is the part that differs between the two copies of the portal. The copy that uses Claude is in the folder called hcml-portal and answers on port 8081. The copy that uses a model on the same machine is in the folder called hcml-portal-ollama and answers on port 8082.

### The copy that uses Claude

Nothing is sent when a page opens. Text is sent only when someone asks, and only the text for that request.

- When someone presses Explain on a problem, the portal sends the problem's name and its operational data, its severity, its device, its age, whether it was acknowledged, and, to a model on this machine only, its tags (twenty at most, each cut short): a model outside the machine is given no tags, which are free text that staff write. For an SLA figure it sends the target, the period and each service's figures; for the derived availability figure it also sends the group's name, how the figure was worked out, the counts of devices, and the names and figures of up to twelve of the worst devices.
- When someone asks the Assistant a question, the portal sends the question, the last few turns of the conversation (up to about three thousand characters) and a summary of the estate that it builds from its cached reads (it reuses one for up to five minutes while nothing it describes has changed): the open problems with their devices, severities, ages and acknowledgement states (no tags), counts over all open problems, each site with how many devices answer and its worst severity, the devices that are unreachable or silent, grouped by site, the SLA standing, and the services that are degraded. When the question names a site, it adds that site's devices by state and their worst problems. When the question asks for more, the portal reads it from Zabbix and adds it: the problems that opened in the time the question names, closed or not, with their devices; the latest CPU, memory, temperature, disk, traffic, uptime or ping readings of the device or site it names; and, for a device it names, its state, its groups and the templates it uses. It can also read the lowest, average, highest and last of a reading over a time, the SLA of a month, a year or a week, every open problem of a site, the maintenance windows, the WAN links and the web checks, the state of one port, the capacity, alert noise and top trigger reports, and what a device is linked to on the maps. It never sends a device's addresses, tags or inventory, the contacts on record, the description of a device, the far end or the label of a link, the alias of a port, the labels on a map, the name of a maintenance window, or the names and reasons of the people who acknowledged a problem (only that it was acknowledged, how often and when last) to a model outside the machine. It reads the tags, the inventory and the contacts only for a person who has the Inventory page, the names of those who acknowledged only for an operator, and none of this for a person whose pages do not show it. The summary is plain text of a few thousand characters.

The destination is Anthropic, an external AI service. Under every answer the page says so: "To write this, the details shown here were sent to Anthropic, an external AI service." for Explain, and "Each question, and a summary of the estate, is sent to Anthropic, an external AI service." for the Assistant.

These texts contain device names, site names and problem texts, which are whatever people typed into Zabbix. They contain no password, token or key. What the provider does with the text is outside the portal's control and outside this handbook. HCML should read the provider's terms before this copy is used with real data.

Each person is limited to ten questions and ten explanations a minute. A model that bills by the call has a daily budget of tokens, which are the units the provider bills by: by default half a million for each person and two million in all, counted from what the provider reports (or, when a reply carries no count, from an estimate of four characters to a token) and reset at midnight in the reporting time zone. That is hosted Claude, and a model at an address outside the machine's own network; a model on the machine has no bill and no budget. Once a budget is used up, the portal refuses further requests until midnight and says so.

### The copy that uses a model on the machine

The same texts are built and sent to a model that runs on the host machine itself, reached on its own address. The texts stay on the machine. The page shows no notice, because there is nothing to disclose. This copy has no bill and no daily budget. The one thing it can send out is the monthly report by email, as the report email below explains.

That promise is kept by the server and not by the page. The settings of this copy say that it must send nothing away, and the server then refuses to start when the address of the model is outside this machine and its own network. A model counts as local when its address is the machine itself, a private address, a name of one word, or a name that ends in one of the endings that only resolve inside a network, so a model on another machine of HCML's own network passes, and a public address does not. Only an explicit second setting lets an outside model through: the server then starts with a warning, the page says beside every answer that the text left the network. The daily token budget counts a model outside the network as it counts hosted Claude, by the model's own count of tokens or else by an estimate (BK-69, SC-53). Whether a model on another machine of HCML's counts as local is for us to confirm: the rule above is the portal's own choice.

### The report email, in the copy that uses Claude

Either copy can email the monthly SLA report. It is off until the settings name a mail account. An administrator presses a button and types the addresses the report goes to (up to ten, in the domains the settings allow if they name any), or sets the portal to send it by itself on a day of each month. The message goes to those addresses with the report attached, in one to three kinds of file. Only an administrator can do either.

The report names every device and shows how each site did. Once it is in a mailbox, the portal cannot control who reads it, forwards it or keeps it. The message goes to the mail server named in the settings, and from there to the recipients' mail. Use a mail account made for the portal and not a personal one, and give the list only to people who may read the report. **Set the list of allowed domains** in the settings: without it, a stolen administrator sign-in could send the report to any address, five an hour. In the copy that uses a model on the machine this is the only thing that can leave the machine, so leave its mail settings empty if that promise matters more than the email.

The server's log keeps one line for each attempt: who asked, the month, the formats, the size, how many people it reached and the domains they are in. It keeps no address, no subject and no file. The portal also keeps a few small files of its own, on a volume (a folder that Docker keeps outside the containers, so that it is still there after a rebuild): the saved addresses, the schedule and a short record of what was sent, with counts and no address in the record; the web check figures of months that have closed; and the people who can sign in, with a scrambled hash of each password. The mail account's password sits in the settings file, with the other secrets.

### If nothing may leave

Use the second copy. Or leave the model key out of the first copy's settings: without a key the model features are off, the Explain buttons are not shown and the rest of the portal works as before. The second copy emails a report only when its mail settings are filled in. Leave them empty in both copies and no report is ever emailed.

## What never leaves the server

Passwords, the Zabbix tokens, the model key and the secret that signs sessions stay on the server. The browser gets a session cookie and nothing more. The model gets text built from Zabbix data and nothing else, and it has no way to read the settings or to reach Zabbix.
