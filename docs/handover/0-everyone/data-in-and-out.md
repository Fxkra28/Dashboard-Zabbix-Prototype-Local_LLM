# Data in and out

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Everyone | about 8 min | [Can I trust it](can-i-trust-it.md) | [What HCML provides](what-hcml-provides.md) |

> **Ringkasan**
>
> - Portal membaca data hanya dari API Zabbix milik HCML, dan hanya menulis satu hal: tanda sudah diketahui atau penutupan sebuah masalah.
> - Portal tidak menyimpan data jaringan. Yang tersimpan hanyalah berkas pengaturan (akun, token, ambang batas), catatan log, dan, pada salinan yang memakai Claude, satu berkas kecil berisi daftar penerima, jadwal pengiriman bulanan dan catatan pengiriman terakhir (tanpa alamat).
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
| The server's settings file | The accounts and their roles and passwords, the Zabbix tokens, the model key, the secret that signs sessions, thresholds and targets | Until someone edits it. It is not in the repository, and it is the one thing to back up by hand |
| The server's logs | Each request with an id (the health check's are left out), the address it came from and its result. Each sign-in. Each acknowledgement, with the person's name and address. Each use of the AI and each report download or email, with who did it, what kind and how it ended, and never the question, the answer, a file or an address. A token in an address is hidden before it is written | Docker keeps up to five files of fifty megabytes for each container and then overwrites the oldest |
| The `portal-state` volume (the hosted copy only) | The saved addresses, the monthly schedule and a record of the last 24 sends, with counts and no address in the record | Until someone deletes the volume. No backup holds it unless it is copied out by hand |
| The browser | A session cookie that the scripts on the page cannot read. The theme and whether the menu is collapsed. The Assistant conversation, in that tab only | The cookie until the session ends. The choices until the browser is cleared. The conversation until the tab closes or the person signs out |

Nothing else is stored. There is no analytics, no tracking and no report back to anyone: the page is allowed to contact only its own site, and the fonts are served from that site too, so a visit fetches nothing from outside.

## What leaves HCML's network

This is the part that differs between the two copies of the portal. The copy that uses Claude is in the folder called hcml-portal and answers on port 8081. The copy that uses a model on the same machine is in the folder called hcml-portal-ollama and answers on port 8082.

### The copy that uses Claude

Nothing is sent when a page opens. Text is sent only when someone asks, and only the text for that request.

- When someone presses Explain on a problem, the portal sends the problem's name and its operational data, its severity, its device, its age, whether it was acknowledged, and every tag on it. For an SLA figure it sends the target, the period and each service's figures; for the derived availability figure it also sends the group's name, how the figure was worked out, the counts of devices, and the names and figures of up to twelve of the worst devices.
- When someone asks the Assistant a question, the portal sends the question, the last few turns of the conversation (up to about three thousand characters) and a summary of the estate that it builds from its cached reads (it reuses one for up to five minutes while nothing it describes has changed): the open problems with their devices, severities, ages and acknowledgement states (no tags), counts over all open problems, each site with how many devices answer and its worst severity, the devices that are unreachable or silent, grouped by site, the SLA standing, and the services that are degraded. When the question names a site, it adds that site's devices by state and their worst problems. The summary is plain text of a few thousand characters.

The destination is Anthropic, an external AI service. Under every answer the page says so: "To write this, the details shown here were sent to Anthropic, an external AI service." for Explain, and "Each question, and a summary of the estate, is sent to Anthropic, an external AI service." for the Assistant.

These texts contain device names, site names and problem texts, which are whatever people typed into Zabbix. They contain no password, token or key. What the provider does with the text is outside the portal's control and outside this handbook. HCML should read the provider's terms before this copy is used with real data.

Each person is limited to ten questions and ten explanations a minute. The hosted copy also has a daily budget of tokens, which are the units the provider bills by: by default half a million for each person and two million in all, counted from what the provider reports (or, when a reply carries no count, from an estimate of four characters to a token) and reset at midnight in the reporting time zone. Once a budget is used up, the portal refuses further requests until midnight and says so.

### The copy that uses a model on the machine

The same texts are built and sent to a model that runs on the host machine itself, reached on its own address. Nothing leaves the machine. The page shows no notice, because there is nothing to disclose. This copy has no bill and no daily budget, and it never emails a report, as the report email below explains.

### The report email, in the copy that uses Claude

The copy that uses Claude can email the monthly SLA report. It is off until the settings name a mail account. An administrator presses a button and types the addresses the report goes to (up to ten, in the domains the settings allow if they name any), or sets the portal to send it by itself on a day of each month. The message goes to those addresses with the report attached, in one to three kinds of file. Only an administrator can do either.

The report names every device and shows how each site did. Once it is in a mailbox, the portal cannot control who reads it, forwards it or keeps it. The message goes to the mail server named in the settings, and from there to the recipients' mail. Use a mail account made for the portal and not a personal one, and give the list only to people who may read the report. **Set the list of allowed domains** in the settings: without it, a stolen administrator sign-in could send the report to any address, five an hour. The copy that uses a model on the machine never emails a report: its settings file passes none of the mail settings to it, on purpose, so that nothing leaves the machine there.

The server's log keeps one line for each attempt: who asked, the month, the formats, the size, how many people it reached and the domains they are in. It keeps no address, no subject and no file. The portal also keeps one small file of its own, on a volume: the saved addresses, the schedule and a short record of what was sent, with counts and no address in the record. The mail account's password sits in the settings file, with the other secrets.

### If nothing may leave

Use the second copy. Or leave the model key out of the first copy's settings: without a key the model features are off, the Explain buttons are not shown and the rest of the portal works as before. The second copy never emails a report. In the first, leave the mail settings empty and no report is ever emailed.

## What never leaves the server

Passwords, the Zabbix tokens, the model key and the secret that signs sessions stay on the server. The browser gets a session cookie and nothing more. The model gets text built from Zabbix data and nothing else, and it has no way to read the settings or to reach Zabbix.
