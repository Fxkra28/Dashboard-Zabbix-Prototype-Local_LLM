# Email the SLA report through SMTP, when an administrator asks, and keep it off until it is set up

* Status: accepted, amended on 2026-11-04 by [ADR-0015](0015-keep-a-small-state-file-for-recipients-and-the-schedule.md): who a report may go to, and the schedule
* Deciders: HCML internship project; the owner asked for the feature, for general mail accounts such as Gmail, on 4 November 2026, after HCML had no SMTP details to give
* Date: 2026-11-04

## Context and Problem Statement

[ADR-0011](0011-build-the-sla-report-files-in-the-bff.md) made the monthly SLA report a PDF and an Excel file, built when asked and kept nowhere, and left the rest of HCML's Goal 6 undone: a report that is emailed. On 2 November 2026 the owner asked whether the portal could send it. On 4 November they answered that HCML had no SMTP details to give and that HCML's mail was its own, and asked for the feature to be built for general accounts, Gmail and the like, for now.

What was found the same day matters for the choice. HCML's public mail records point to Microsoft 365, and the sender policy lets only Microsoft send for the domain. For Microsoft 365 the usual login by name and password (SMTP AUTH with basic authentication) is turned off by default for existing tenants at the end of December 2026, according to the Exchange team's update of January 2026, and OAuth is the supported way. So the account HCML has is the one a password login suits least, and any other provider's address cannot be used as HCML's sender without HCML's administrator changing its DNS.

How does the portal send a file by email, to whom, and under whose control, when it has no database, holds estate data, and until now sent nothing out except to Zabbix and, in one copy, to a model provider?

## Decision Drivers

* Sending is a new way out for estate data. The report names every device. Who can trigger it and where it can go must be few and fixed.
* A new secret, the mail password, joins the Zabbix tokens and the session secret in `.env`. It must never reach a log, a response or the browser.
* The portal keeps nothing ([ADR-0003](0003-no-database.md)), so nothing can remember what was sent, and nothing in this decision may need that.
* A mistake in a setting must not stop the portal from showing monitoring data.
* It must be testable without a real mail account, because none was available.
* The two portals share one source tree, and one of them exists so that nothing leaves the machine: the feature has to be absent there, not only off.

## Considered Options

* SMTP through the `nodemailer` library, with presets for Gmail, Yahoo, Zoho and iCloud and a generic `smtp` for a server of one's own.
* A hand-written SMTP client, in the manner of ADR-0011.
* Microsoft Graph's `sendMail`, from an application limited to one mailbox.
* SMTP with OAuth2 for each provider.
* A mail service's HTTP API (SendGrid and the like).
* Recipients typed on the page.
* Nothing: download the file and attach it by hand.

## Decision Outcome

Chosen: **SMTP through `nodemailer`, administrator only, off until the settings are whole.**

* **Who and to whom.** Only an administrator can send. *As decided on 4 November 2026 morning:* the recipients were `MAIL_TO`, at most ten, and a request named the month and the format and nothing else, so a stolen administrator session could send the report only to the people already on the list. *Amended the same afternoon by [ADR-0015](0015-keep-a-small-state-file-for-recipients-and-the-schedule.md):* the sender types the addresses, one to ten of them, each in `MAIL_ALLOWED_DOMAINS` when that setting is used, and a list can be saved; `MAIL_TO` is only where the saved list starts. A request still names nothing but the month, the files, the people and the style; there is no subject, message, copy or blind copy to set. The price is that a stolen administrator session can now send the report to an address of its choice, five an hour, unless the domains are limited.
* **How often.** Five sends an hour for each person, counted in memory, so a stuck button cannot fill inboxes or get the sending account blocked.
* **Off by default, and tolerant.** With every `MAIL_` setting blank there is no route to a mail server and no button. A setting that is present and unusable leaves email off, says which in the start-up log, and lets the portal start.
* **No login in the clear.** `none` for the connection security is refused together with a password. With `starttls` the connection is encrypted before the login, and a server that does not offer it is a failure.
* **Fail early, fail plainly.** The mail login is tried before Zabbix is read, so a wrong password costs a second. Every failure is one fixed sentence for its kind. What the mail server said goes to the log, with the login name and the password taken out.
* **What is logged.** One line for each attempt: the person, the month, the format, the size, how many recipients, the outcome. Never an address, the subject, the file or the password.
* **The message.** The file the download gives, attached, with a plain-text body made from the report's own first-page figures, marked as automatic so an out-of-office reply does not come back.

### Positive Consequences

* The report can leave the portal without a person downloading it and attaching it.
* Nothing about the estate is stored. *Morning:* nothing was stored at all. *Afternoon:* the recipients, the schedule and a record of the sends (counts, never an address) are kept in one small file ([ADR-0015](0015-keep-a-small-state-file-for-recipients-and-the-schedule.md)).
* Everything on the way is tested against a real socket: TLS, STARTTLS, the login, the failures, and that a password is not sent to a server that cannot encrypt.
* Gmail, Yahoo, Zoho, iCloud, a web host's mailbox or a company mail server all work with the same code.

### Negative Consequences

* **A ninth dependency,** and the only library behind the report features. `nodemailer` has none of its own, is MIT-0 licensed, and a runtime audit on 4 November 2026 found nothing. ADR-0011 avoided libraries for the file formats because a reader's quirks are the library's job; here the quirks (TLS, STARTTLS, AUTH, MIME encoding, header injection) are exactly the ones a hand-written client would get wrong.
* **HCML's own mail cannot be used yet.** It waits for HCML's Microsoft 365 administrator.
* **Estate data can now leave the machine by email, in `hcml-portal`.** `hcml-portal-ollama` exists so that nothing leaves the machine, so its compose file passes none of the mail settings (the owner's word, 4 November) and a test pins the difference. In `hcml-portal` the feature is off until a mail account is named, and then only an administrator can send.
* **A real mail server has been reached once.** On 9 November 2026 Gmail accepted the login and two reports, and both landed in the recipient's spam folder (tracker IN-62). The Yahoo, Zoho and iCloud settings come from the providers' help pages and from third-party guides, and were tried only against a stand-in server.
* **No schedule.** *Left out on the morning of 4 November*, because a monthly send needs somewhere to remember what was sent and a host that stays up, and the Mac that runs the portal was down for 37 hours after a restart in October (tracker IN-43). *Built that afternoon,* with a small state file and a retry for a week: [ADR-0015](0015-keep-a-small-state-file-for-recipients-and-the-schedule.md).

## Pros and Cons of the Options

### SMTP through `nodemailer`, with presets

* Good, because it works with the accounts available now and is tested against a real socket.
* Good, because the library handles the parts that are easy to get wrong.
* Bad, because it adds a dependency and a secret, and cannot use Microsoft 365 by password after December 2026.

### A hand-written SMTP client

* Good, because it adds no dependency.
* Bad, because TLS, STARTTLS, three AUTH mechanisms, dot-stuffing, base64 and quoted-printable encoding and header-injection defense are many things to get right, and a mistake is a security hole in a part that handles a password. Rejected.

### Microsoft Graph's `sendMail`

* Good, because it suits HCML's Microsoft 365: ordinary HTTPS, no mailbox password, no SMTP, no new library, and an application can be limited to one mailbox by the administrator.
* Bad, because it needs HCML's administrator to register the application and give the portal three values, and the owner asked for general accounts for now. **Not built; the next step if HCML agrees.**

### SMTP with OAuth2 for each provider

* Good, because it is what Microsoft and Google prefer.
* Bad, because each provider needs a registered application and a token flow, which is more than one person can set up without the account owner. Not built.

### A mail service's HTTP API

* Good, because it is built for applications.
* Bad, because it ties the portal to one vendor's account and sender checks (SPF, DKIM) for HCML's domain. Most of these services also speak SMTP, so the generic `smtp` setting reaches them without a second code path.

### Recipients typed on the page

* Good, because it is flexible, and it is what the owner asked for.
* Bad, because a stolen administrator session could then send the estate to any address. Rejected in the morning of 4 November; chosen the same afternoon with the list of allowed domains this option named as the way to add it, and the five sends an hour kept ([ADR-0015](0015-keep-a-small-state-file-for-recipients-and-the-schedule.md)).

### Nothing

* Good, because nothing new leaves the machine.
* Bad, because someone has to download and attach the file every month, which is the work Goal 6 is meant to remove.

## Links

* [`docs/setup/18-automated-reporting.md`](../../setup/18-automated-reporting.md), *Emailing the report*: the settings, the accounts, the checks and what was not checked
* [`docs/handover/3-integrations/reports-exports.md`](../../handover/3-integrations/reports-exports.md)
* [`docs/api/openapi.yaml`](../../api/openapi.yaml): `/api/sli/email`
* Microsoft Exchange Team, *Updated Exchange Online SMTP AUTH Basic Authentication Deprecation Timeline*, January 2026
* Microsoft Learn, *Role Based Access Control for Applications in Exchange Online*
