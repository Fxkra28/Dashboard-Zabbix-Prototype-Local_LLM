# The decisions, in plain words

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Everyone | about 9 min | [Exercises](../4-working/exercises.md) | [Choices compared](choices-compared.md) |

Fifteen decisions shape the portal. Each is recorded in full in `docs/architecture/adr/`, in a fixed form that names the options that were considered and at least one cost. This page says each in a few lines, in plain words, so that you can see the whole shape at once and open the record when you need the argument. A decision here that you want to change is a decision to write another record about: [the contributing guide](../../contributing.md) says when.

## What the portal is, and is not

### A read-only layer over Zabbix, and not a change to Zabbix

Zabbix is production, and breaking it breaks monitoring for the whole estate. So the portal is a separate service that asks Zabbix's API for what it needs and touches nothing inside it. It holds a token and never reaches Zabbix's database, its configuration or its files. Several views, such as sites, WAN links and a monthly SLA, have no Zabbix entity at all, and only this shape can express them. The cost is that everything is worked out again on each request, because nothing is stored. [ADR-0001](../../architecture/adr/0001-bff-over-zabbix-api.md).

### The same language on both sides

React, TypeScript and Vite in the browser, and Fastify and TypeScript on the server, with ECharts for the charts. One language means a shape can be written once and checked on both ends, and the ecosystem is large and dull, which suits a project that will be handed to someone who has not seen it. Fastify won on its hook order, which here is load-bearing. The cost is two build tools and two sets of installed packages. [ADR-0002](../../architecture/adr/0002-react-typescript-fastify.md).

### No database

Two copies of one number is the usual way to ship a wrong dashboard, and anything stored has to be backed up and kept in step. So the portal stores almost nothing. Each value is worked out for the request and held in memory, in one map capped at 500 entries or about 64 MB, with a lifetime from 15 seconds to 24 hours for each key. The cache joins simultaneous misses into one read, so twenty screens cost one read of Zabbix. The cost is that the `.env` files hold the portal's secrets and settings and nothing else backs them up, and that a restart loses every cached answer, including a closed month's SLA. The one exception, added on 4 November 2026, is a small state file in the hosted copy for the people a report goes to and the monthly schedule ([ADR-0015](../../architecture/adr/0015-keep-a-small-state-file-for-recipients-and-the-schedule.md)). [ADR-0003](../../architecture/adr/0003-no-database.md).

### Keep asking Zabbix, and do not copy its data

A trivial count of hosts costs more than twenty SQL statements inside Zabbix, and the first guess about where the time went was wrong, so the decision was made from measurements. Zabbix's API stays the single source of truth. A copy of its telemetry in the portal was rejected. Reading Zabbix's database directly was judged to have a case, and was put behind three cheaper fixes. Several lighter reads have been made since, which [the traps](../4-working/traps.md) list. The cost was that slow reports stay slow until the fixes are done, and some pages still wait on HCML's Zabbix. [ADR-0007](../../architecture/adr/0007-keep-the-zabbix-api.md).

## What the portal computes

### The monthly SLA is worked out in the portal

HCML's Zabbix has no services and one placeholder SLA with nothing attached, so Zabbix's own SLA engine has nothing to measure. The figure also has to reproduce HCML's published numbers, or nobody will trust it. So the portal replays the problem and recovery events of the ICMP triggers across the month, in two methods: HCML's own, and a strict one that leaves out hours in which nothing was collected. The cost is a reimplementation of something Zabbix ships, which has to stay correct as Zabbix changes. [ADR-0004](../../architecture/adr/0004-derive-the-sla-in-the-portal.md).

### The SLA report files are built by the server, by hand

The PDF and the workbook carry the figures the SLA page shows, in both methods, and not a second calculation that could disagree with the screen. They are printed and attached to mail, so they have a fixed page and the light colours. The writers are hand-written with Node's own modules, because the project has a rule of no new dependencies. The cost is that the project now owns two file formats and every reader's quirks, a large price that the record says to read before reaching for a third. [ADR-0011](../../architecture/adr/0011-build-the-sla-report-files-in-the-bff.md).

### The traffic meters are read from HCML's own Zabbix dashboard

The capacity of a link is a figure that someone typed once, in Zabbix. A second copy would drift, and two screens would give two answers about one link. The repository is public, so a list of HCML's links and their capacities must not be committed. So the portal reads the gauge widgets of the dashboard HCML already keeps, and stores nothing. The cost is a dependence on the shape of a Zabbix widget, whose field names are Zabbix 7.0's. [ADR-0012](../../architecture/adr/0012-internet-meters-from-the-zabbix-dashboard.md).

## Who may do what

### One write, behind a separate token

The portal can acknowledge a problem and close one, and nothing else. There are two tokens: one that reads, and a separate one that is used for exactly one call. Three gates are independent: the credential, the role (operator and above), and the setting (with no write token the route says 503 and the page hides the buttons). The cost is that Zabbix files every write under the write token's owner and cannot tell the portal's operators apart, so the portal puts the user's name in the message and in its own log. There is also a gap that the record admits: the tokens of HCML's Zabbix belong to users whose role is Super admin, which allows everything, so the read token is never used to write in the code, but it could write if someone else held it. [ADR-0006](../../architecture/adr/0006-read-only-with-one-write.md), and open item SC-23 in the tracker.

### An open portal renews its own sign-in

A wall screen must stay live with nobody at its keyboard, and the owner asked for the same for every user. So an open page renews its session about an hour before it ends, and the server looks the user up again each time, so a removed user cannot renew and a changed role takes effect. There is still no new dependency and no database. [ADR-0009](../../architecture/adr/0009-renew-an-open-portals-sign-in.md).

### The session is an httpOnly cookie

No script on the page should be able to read the credential, and no credential should be in any address, the live stream's included. So the token lives in a cookie that scripts cannot read, with a defence against a request from another site, and the server stays free of a session store. Scripts and tests keep a way in with a bearer header. [ADR-0010](../../architecture/adr/0010-session-cookie.md).

## How it is built and run

### A model layer that does not depend on one provider, and two copies of one tree

Whether estate data leaves the machine must be a visible choice. So there is one layer for the plain-language features, and a setting picks hosted Claude or a local model, and the two deployments are two folders that share one source tree (only the hosted one is under git), so that the comparison between them is fair. The cost is two deployments to keep in step for ever. [ADR-0005](../../architecture/adr/0005-provider-neutral-ai-layer.md).

### The server by layer, the web app by feature, the checks in one place

A change to one endpoint or one page should touch one place. Routes check the input and call a service, the web app is grouped by feature, and every rule that is written in a document is also a test that fails. No behaviour changed in the move. The cost is that history is harder to follow: files moved folder, and `git blame` points at the commit of the move. [ADR-0013](../../architecture/adr/0013-layers-features-and-tools.md).

### Email the report through a mail account, when an administrator asks

The portal can send the monthly report to people, through any mail account that lets an application log in with a name and a password. Only an administrator can send it, and nothing is sent until the settings name an account. It was built for general accounts such as Gmail because HCML had no mail details to give, and HCML's own mail, on Microsoft 365, needs its administrator and a different kind of login. It exists in the copy that uses Claude only: the copy that uses a model on the machine passes none of the mail settings, so that nothing leaves the machine there. The cost is a new secret in the settings file, one new library, and a new way for report data to leave the machine. [Decision record 14](../../architecture/adr/0014-email-the-sla-report-through-smtp.md) has the options and the reasons.

### Keep a small state file for the recipients, the schedule and what was sent

The owner asked that the sender choose who gets the report and that it go by itself on the first of each month. Both need the portal to remember something, so it keeps one small file on a Docker volume: the saved addresses, the schedule, and a record of the last 24 sends with counts and no address. The cost is that the portal now has state to back up, the container writes to one folder, and a stolen administrator sign-in could send the report to an address of its choice unless the domains are limited in the settings. [Decision record 15](../../architecture/adr/0015-keep-a-small-state-file-for-recipients-and-the-schedule.md) has the options and the reasons.

### Stop polling from a development machine

This record is about a local copy of Zabbix that has since been deleted, and it protected HCML's equipment from a second monitoring system aimed at production, and made the safe configuration the default. Since 29 October 2026 the portals read HCML's own Zabbix over the office network, and the local copy and its data are gone. The record stays as the history of why the copy was stopped, and of what its data was. [ADR-0008](../../architecture/adr/0008-stop-local-polling.md).

## What is not written down as a decision

Naming, formatting, a setting's default, and anything that could be reversed in an afternoon do not get a record. A choice that has a real trade-off, a technology, a pattern, or something the team has to agree on, does, with at least one negative consequence. A record with only good things in it reads as a press release, and is sent back.
