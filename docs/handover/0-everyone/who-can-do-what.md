# Who can do what

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Everyone | about 9 min | [The pages, as questions](the-pages.md) | [Can I trust it](can-i-trust-it.md) |

> **Ringkasan**
>
> - Ada tiga peran: guest, operator dan admin. Peran bukan tingkat jabatan, melainkan alasan yang berbeda untuk membuka portal. Selain peran, setiap orang punya daftar halaman sendiri.
> - Guest membaca halaman yang diberikan kepadanya. Operator menambah satu tindakan: menandai masalah sebagai sudah diketahui atau menutupnya. Admin menambah halaman Inventory dan Users, dan dapat mengirim laporan SLA bulanan lewat email.
> - Layar dinding adalah akun guest yang diberi halaman Network dan Links & WAN health serta meter lalu lintas internet. Ia hanya membaca dan bukan orang.
> - Admin membuat akun, memilih halamannya dan mematikan akun di halaman Users. Admin pertama, yang menjadi jalan masuk darurat, tetap ditulis di berkas pengaturan server.
> - Sesi berlaku 12 jam secara bawaan dan diperbarui sendiri selama halaman terbuka. Terlalu banyak sandi salah mengunci masuk untuk sementara.

## Three roles, and pages of their own

A role says what a person may do, and the pages say what they may see. The roles are not ranks of seniority. Each is a different reason to look at the screen, and each includes everything the one before it can do. The pages are given person by person, so two guests can have different menus.

| Role | Who it is for | What it can open | What it can change |
|---|---|---|---|
| Guest | Anyone who needs to know whether things work | The pages an administrator gave them. A new guest starts with every page except Network, Links & WAN health, the internet traffic meters, the inventory scorecard and Users and access. Graphs and Latest data leave out the measurements of network ports for a person who lacks the Network page | Nothing |
| Operator | The person who watches the portal and acts on what it shows | The same pages as a new guest, and the network pages too | Acknowledge and close problems |
| Admin | The person who looks after the portal and its records | Every page, including the inventory scorecard and Users and access | The same as an operator, plus emailing the monthly SLA report to addresses they choose, setting it to go by itself each month, and adding, changing and disabling the people who can sign in |

A guest is trusted with the state of the whole estate and with none of its actions. By default the line falls at the network pages, which show which links join which sites. That is closer to infrastructure documentation than to monitoring, and it is the likeliest reason for the line, though no document records the reason. A guest needs to know whether things work, not how they are wired. An administrator can move the line for one person by giving them the page.

Before 17 November 2026 the portal had four roles, viewer, wall, operator and admin. Accounts written with the old names still work: a viewer is read as a guest, and a wall account as a guest who also has the network pages.

## The wall

A screen that anyone can walk up to must never be able to acknowledge or close a problem. So a wall screen is a guest. It is given the network pages and the internet traffic meters, and it can change nothing.

Nobody sits at a wall screen and clicks. It is signed in with an account made for it. With the Network page, the Dashboard turns by itself between its tabs, including the internet links. A screen without that page turns between the first two tabs only, because the third shows network port data. Give a wall screen its own account, and not an operator's, because an operator's session on a screen nobody watches is still an operator's session.

## What happens when an operator acknowledges a problem

1. The Dashboard shows a new problem without anyone reloading the page.
2. The operator reads its severity, its device and how long it has lasted. If the portal has a model to ask, Explain puts it in plain words.
3. The operator decides it is known, or being handled.
4. On the Problems page the operator acknowledges it, with a message, and can close it as well.
5. The portal sends this to Zabbix with a note of the operator's name added to the message. Zabbix files every such change under the account the portal uses for writing, so without that note nobody could tell who clicked. The portal also logs the attempt with the name and the address, whether or not it worked.
6. The row says that it was sent and that the portal is waiting for Zabbix. Zabbix takes a few seconds to apply the change, and for up to about fifteen seconds the problem can still read as open. After a minute with no change, the row offers the button again.

Nothing records that a decision was made, only that an acknowledgement was sent. Apart from the note in Zabbix and the server's log, the portal keeps no record of who did what, except that the small state file of each copy holds the name of whoever sent a report by email or set the monthly schedule.

If the write has been switched off for the whole portal, operators see the line "Acknowledge is off on this portal. Ask the portal admin to turn it on." and no button.

## How accounts are made

An administrator makes them on the Users page. They give a name, a role, the pages the person may open and a first password. That password is a temporary one: the person chooses their own the first time they sign in, and nothing else opens until they have. An administrator can change a person's role and pages at any time, set a date after which they can no longer sign in, reset a password, or disable the account. A person is never deleted from the page, only disabled, so the log keeps the name. Everyone but the first administrator can change their own password on the Account page; the first administrator's password is changed in the portal's settings. Where the portal allows it, which is off until someone switches it on, a person who cannot sign in can ask for an account on the sign-in page, giving a name, the pages they want and a reason. The request waits on the Users page until an administrator approves it, by making the account as for anyone else, or refuses it.

The first administrator is not made on the page. The person who runs the portal writes it in the portal's settings, and it is the way in if everything else is lost. Other people can be written there too: they are copied into the users file when the portal next starts, and from then on the page manages them. Taking a name out of the settings afterwards changes nothing for a person who was copied: Disable on the page is what ends their access. The users are kept in a small file of their own on the server, each password stored as a scrambled hash, and it is saved with the rest of the portal's state when that is backed up. The page warns when the connection is not encrypted, because passwords typed there would then travel in clear text.

Two things follow from the way it is built. Disabling a person, or changing their role or pages, takes effect on their next click, because the portal looks the person up again on every request. A page that is already open follows the change too: it reads the account again when its tab is shown or comes to the front (at most once a minute), after each renewal of the session and every ten minutes while it stays in view, so a page that was given or taken away shows without a reload, and a screen of a person who was disabled loses its live updates. And the person who runs the portal can end every session at once, for everyone, with one change to the settings.

## Signing in, and staying signed in

You sign in with a name and a password. By default the session lasts twelve hours, and the operator can set it anywhere from two to twenty-four. A page that stays open renews its own session an hour before it would end, so a wall screen stays signed in for as long as its page is open. A closed page renews nothing. Signing out in one tab sends every other open tab to the sign-in page.

The portal accepts at most ten sign-in attempts a minute for one account from one address. After ten failures in a row the account is locked from that address for a minute, and each further failure doubles the lock, up to five minutes. A correct sign-in clears the count. The lock is short on purpose, because everyone behind the same server shares one address, and a long lock would lock a person out because of someone else's typing.

The two copies of the portal use different session names, so signing in to one does not sign you out of the other, and a session from one is not accepted by the other.

## If you cannot do something you expected

| What you see | The likely reason | Who changes it |
|---|---|---|
| No Network or Links & WAN health in the menu | Your account was not given those pages | An administrator, on the Users page |
| A message saying your account does not have a page | You opened its address directly | The same |
| No acknowledge button | Your role is guest, or the write is switched off | An administrator, or the person who runs the portal |
| A request for a new password before anything else opens | Your password is a temporary one | You, by choosing one |
| No Explain button, or it says the AI is not answering | No model is set up, or the model is down. The rest of the portal is not affected | The operator |
| Signed out without asking | The session ended after its time, or the operator ended every session | Sign in again |
