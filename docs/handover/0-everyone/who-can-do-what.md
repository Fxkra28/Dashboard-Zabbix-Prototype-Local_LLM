# Who can do what

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Everyone | about 6 min | [The pages, as questions](the-pages.md) | [Can I trust it](can-i-trust-it.md) |

> **Ringkasan**
>
> - Ada empat peran: viewer, wall, operator dan admin. Peran bukan tingkat jabatan, melainkan alasan yang berbeda untuk membuka portal.
> - Viewer membaca hampir semua halaman. Wall menambah Network, Links & WAN health dan meter lalu lintas internet, hanya untuk dibaca. Wall adalah akun layar dinding, bukan orang.
> - Operator menambah satu tindakan: menandai masalah sebagai sudah diketahui atau menutupnya. Admin menambah halaman Inventory dan dapat mengirim laporan SLA bulanan lewat email, dengan tangan atau otomatis setiap bulan.
> - Akun dan peran dibuat di berkas pengaturan server oleh orang yang menjalankan portal, bukan di halaman web.
> - Sesi berlaku 12 jam secara bawaan dan diperbarui sendiri selama halaman terbuka. Terlalu banyak sandi salah mengunci masuk untuk sementara.

## Four roles, four reasons to open the portal

The roles are not ranks of seniority. Each is a different reason to look at the screen, and each includes everything the one before it can do.

| Role | Who it is for | What it can open | What it can change |
|---|---|---|---|
| Viewer | Anyone who needs to know whether things work | Every page except Network, Links & WAN health, the internet traffic meters and the inventory scorecard. Graphs and Latest data leave out the measurements of network ports | Nothing |
| Wall | A screen on a wall, not a person | Everything a viewer can open, plus Network, Links & WAN health and the internet traffic meters | Nothing |
| Operator | The person who watches the portal and acts on what it shows | Everything a wall screen can open | Acknowledge and close problems |
| Admin | The person who looks after the portal and its records | Everything an operator can open, plus the inventory scorecard | The same as an operator, plus emailing the monthly SLA report to addresses they choose, and setting it to go by itself each month |

A viewer is trusted with the state of the whole estate and with none of its actions. The line falls at the network pages, which show which links join which sites. That is closer to infrastructure documentation than to monitoring, and it is the likeliest reason for the line, though no document records the reason. A viewer needs to know whether things work, not how they are wired.

## The wall

A screen that anyone can walk up to must never be able to acknowledge or close a problem. So the wall role stops one step below operator: it can read the network pages and the internet traffic meters, and it can change nothing.

Nobody sits at a wall screen and clicks. It is signed in with an account made for it. With that account the Dashboard turns by itself between its tabs, including the internet links. A screen signed in as a viewer turns between the first two tabs only, because the third shows network port data that a viewer does not get. Give a wall screen its own wall account, and not an operator's, because an operator's session on a screen nobody watches is still an operator's session.

## What happens when an operator acknowledges a problem

1. The Dashboard shows a new problem without anyone reloading the page.
2. The operator reads its severity, its device and how long it has lasted. If the portal has a model to ask, Explain puts it in plain words.
3. The operator decides it is known, or being handled.
4. On the Problems page the operator acknowledges it, with a message, and can close it as well.
5. The portal sends this to Zabbix with a note of the operator's name added to the message. Zabbix files every such change under the account the portal uses for writing, so without that note nobody could tell who clicked. The portal also logs the attempt with the name and the address, whether or not it worked.
6. The row says that it was sent and that the portal is waiting for Zabbix. Zabbix takes a few seconds to apply the change, and for up to about fifteen seconds the problem can still read as open. After a minute with no change, the row offers the button again.

Nothing records that a decision was made, only that an acknowledgement was sent. Apart from the note in Zabbix and the server's log, the portal keeps no record of who did what, except that the small state file of the hosted copy holds the name of whoever sent a report by email or set the monthly schedule.

If the write has been switched off for the whole portal, operators see the line "Acknowledge is off on this portal. Ask the portal admin to turn it on." and no button.

## How accounts are made

There is no page for it. Accounts and their roles are part of the portal's settings, which are kept in a file on the server, not in a database and not in the browser. The person who runs the portal adds a name, a password and a role to that file and recreates the server part (a plain restart would keep the old settings). A password can be stored in readable form or as a scrambled hash; the hash is safer, and the portal comes with a small helper that makes one.

Two things follow from the way it is built. Removing a person, or changing their role, takes effect on their next click, because the portal looks the person up again on every request. And the operator can end every session at once, for everyone, with one change to the settings.

## Signing in, and staying signed in

You sign in with a name and a password. By default the session lasts twelve hours, and the operator can set it anywhere from two to twenty-four. A page that stays open renews its own session an hour before it would end, so a wall screen stays signed in for as long as its page is open. A closed page renews nothing. Signing out in one tab sends every other open tab to the sign-in page.

The portal accepts at most ten sign-in attempts a minute for one account from one address. After ten failures in a row the account is locked from that address for a minute, and each further failure doubles the lock, up to five minutes. A correct sign-in clears the count. The lock is short on purpose, because everyone behind the same server shares one address, and a long lock would lock a person out because of someone else's typing.

The two copies of the portal use different session names, so signing in to one does not sign you out of the other, and a session from one is not accepted by the other.

## If you cannot do something you expected

| What you see | The likely reason | Who changes it |
|---|---|---|
| No Network or Links & WAN health in the menu | Your role is viewer | The operator, by giving you the wall role or a higher one |
| A message saying a page is for another role | You opened its address directly | The same |
| No acknowledge button | Your role is viewer or wall, or the write is switched off | The operator, or the portal admin |
| No Explain button, or it says the AI is not answering | No model is set up, or the model is down. The rest of the portal is not affected | The operator |
| Signed out without asking | The session ended after its time, or the operator ended every session | Sign in again |
