# Let the portal read what a question needs, and keep the model without tools

* Status: accepted
* Deciders: HCML internship project; the owner asked on 18 November 2026 that the Assistant be able to see what its snapshot could not (the past, the values and the address of a device, who is in charge) so that it can be used as an assistant. The design below is ours. Letting the model choose its own reads (tool calling) was named as a separate decision for the owner, and has not been taken
* Date: 2026-11-18
* Amended: 2026-11-19, after the tenth re-audit (SC-63 to SC-65, SC-69, BK-84 to BK-91): the blocks stay within 2,800 characters and not 2,000; the pages each kind needs are listed whole; what an outside model is not given is listed whole; a person whose pages hold back a part is told so; and the places in the lines of the slow reports are taken by name
* Builds on: [ADR-0005](0005-provider-neutral-ai-layer.md), where the Assistant answers from a snapshot and is not an agent, [ADR-0006](0006-read-only-with-one-write.md), and [ADR-0017](0017-keep-the-portals-users-in-a-file-of-their-own.md), where the Assistant sees what the user's own pages show

## Context and Problem Statement

The Assistant is handed a snapshot of the estate in at most 6,200 characters, and a FOCUS block for a site or a host that the question names. On 18 November the owner asked what it cannot see, and the answer was a long list: nothing from the past, so a problem that opened last night and closed this morning is gone; no value of a device, so "berapa CPU switch X?" has no answer; no address, no tag, no inventory, no maintenance window; nobody to ask about a site; and only the 20 worst open problems by name.

The snapshot cannot simply be made to hold all of it. A model of 12 billion parameters on the development Mac reads about 300 tokens a second before it says its first word, so each 1,000 tokens added to every question costs about three seconds on every question, including every question that needs none of it. The context window is 8,192 tokens (`AI_NUM_CTX`), and Ollama's own default is 4,096, and a prompt that overflows is cut from the front, which drops the rules the model answers by.

## Decision Drivers

* The snapshot stays small and a question that needs nothing more is as fast as before.
* The model stays read-only and without tools (ADR-0005, ADR-0006). Nothing it writes can cause a call.
* What a user can learn through the Assistant is no more than their own pages show (ADR-0017).
* A model outside this machine is not given addresses, tags, inventory or contacts.
* HCML's Zabbix is slow: an item search over a host with many items takes seconds. A slow read must not stall an answer, and must not read as "there is none".
* An old reading must never be given as a current one: a host that is down still holds the last CPU it had.

## Considered Options

* A bigger snapshot that holds more of everything.
* Tool calling: the model asks the portal for what it needs.
* The portal reads what the question needs, judging from its words and from the sites and hosts it names, and adds it to the prompt.
* A search index over Zabbix's data, with retrieval by similarity.

## Decision Outcome

Chosen: **the portal reads what the question needs, on the spot, and the model keeps having no tools.** It is the way the FOCUS block for a site already works, extended to what a question can ask for. A question is read for its words in English and in Bahasa Indonesia and for the sites and hosts it names, and what it asks for is read from Zabbix and added to the FOCUS block. `buildDetails` (`assistantDetail.ts`) is the one place that decides.

* **Kinds of read.** The problems that opened in a past window, closed or not, from Zabbix's event history, grouped by host and trigger. The latest values of a host, or the highest across the hosts of a site. What a host is: its state, groups, templates, tags, inventory, addresses and maintenance. The contacts on record, or the plain statement that Zabbix holds none. Then, with the same shape (a reader, a section of a few lines, a rule for the pages it needs): who acknowledged a problem and what they wrote, the SLA of any window and the hours that count, every open problem of a site or a severity, the maintenance windows, the WAN links and the web checks, the lowest, average, highest and last of an item over a time, the state of one port, the capacity, alert noise, top trigger and inventory reports, and what a host is linked to on the maps.
* **The words are a screen and not a judge.** A question that the word list misses is answered from the snapshot alone, as it was before this decision, and says what it does not have. A question caught by mistake costs one read that the model does not use. The list is plain and tested, and grows when a real question is missed.
* **The window is shown.** `windowOf` turns "tadi malam", "kemarin", "minggu ini" or "last 3 hours" into an exact window in the SLA time zone, at most 31 days, and the block opens by saying which window it understood, so a wrong reading is visible and is not taken for fact.
* **A site's CPU and memory come from a list that already exists.** The Dashboard reads the CPU and memory of every host once and keeps it, and a question about a site is answered from that list cut to the site's hosts. A search of a site's items by name was tried first and cannot be made right here: with a small limit it cut the site after its first hosts (the hottest sensor at Pasuruan came out as 50 degrees when it is 71), and with a limit for every host it took longer than HCML's Zabbix allows. Temperature, latency and the other metrics are searched by name, with the limit of one host for each host.
* **Bounded in time and in size.** Each read has nine seconds. The blocks together stay within 2,800 characters (`DETAIL_TOTAL`, raised from 2,000 by FR-66), and a block that would pass that is left out whole, because half of one reads as all of it. At most two hosts, 500 events, three items for a metric on a host, and 100 hosts of a site (40 for the values). One question touches at most four calendar months of SLA (`SLA_MONTHS_MAX`), since each month not read before takes minutes on HCML's Zabbix.
* **A failed read says so.** "Could not be read from Zabbix in time; nothing is known of them from this snapshot", so that silence is not taken for "none". A reading older than the item's own interval is written as old and is not given as current.
* **Each kind needs the pages that show it (ADR-0017).** Past problems need the Problems page. Values need Latest data, traffic also the network pages, and the busiest hosts the Dashboard. Host details need Hosts or Devices. Tags, the inventory fields and the contacts need the Inventory page, and this holds for a model on this machine as well (SC-65). The names of who acknowledged a problem need the operator role, since only an operator can acknowledge. The problem lines of a site or host focus need Problems or the Dashboard, and a person with neither is given counts. An administrator, and a portal with sign-in off, hold all of them.
* **A part that is held back is said to be held back (BK-84).** When a person's pages leave out something a question asked for, the system text carries a `NOT GIVEN TO THIS USER` line that names it, beside the data and not inside the fence the model is told never to obey, so that the model says the account does not have the page instead of answering none or no about what it was never shown. The interface traffic is named for a person who has the values and the graphs and not the Network page.
* **A model outside this machine is given less.** It is given the state, the groups and the templates of a host, and a line saying that the address, the tags, the inventory and the contacts are not given to it, because a tag or an inventory field may hold a person. The same holds for the other free text that staff write: the far end and the label of a WAN link, a host's description, the alias of an interface (also inside the name of an interface item), the labels on the links of a map and of a map element that is not a host, and the name of a maintenance window (SC-64). What is given is cleaned like the rest of the text from Zabbix, and the host, trigger, tag and device names that Explain sends pass the same cleaning and the same fence, with a rule in the prompt that the input is data (SC-63, SC-69). For an acknowledgement it is told that the problem was acknowledged, how often and when last, and not who or why. A model on this machine is given them. The contacts, the tags, the inventory, the description of a host and the name of a maintenance window also need the user to hold the Inventory page (SC-65).
* **The slow lines are shared by name (BK-88).** Each heavy topic of a question (a report, a month of SLA) takes a place in the person's line of heavy reports or of SLA reads, as a report page does, and a topic that finds none is told so. The reader's leaving stops the reads that take a signal (BK-91), the noise and trigger reports are asked for the periods their pages offer, and Explain's SLA read is guarded the same way.
* **The rules of the prompt do not change.** The model is told no more than before and has nothing new to call. What it is shown is fenced as data and cut to one line a piece like every other text from Zabbix.

### Positive Consequences

* The Assistant can answer about last night, about one device's CPU, memory or temperature, about an address, and about who is on record for a site, and says so plainly when Zabbix holds nothing.
* A question that needs none of it is as fast as before, because nothing is added to its prompt.
* The model gains no way to act. A wrong answer is still the worst case.
* Each reader is a plain function with its own tests and its own bounds. If the owner later wants the model to choose its reads, those functions are the tools and the permission checks stay where they are.

### Negative Consequences

* **A question the words miss gets no detail.** It is answered from the snapshot, which says what it lacks, but the reader has to ask again in other words.
* **A read costs Zabbix a call and the reader a wait.** Up to nine seconds before the first token on a slow Zabbix. On the Mac with gemma4:12b, one question that read the past took about 20 seconds in all, with a prompt of about 3,500 tokens (18 November).
* **A model still reads a block loosely.** In the same trial one answer opened with "no problems are still open" before listing what had closed, and one dropped the count of repeats. The blocks are written to be easy to read, and the page still says to confirm on the page before acting.
* **A report or a month not read before is not waited for.** An SLA window takes one to two minutes on HCML's Zabbix the first time (98 and 131 seconds were measured), the capacity report about a minute and the alert noise report 23 seconds. After nine seconds the block says that it is still being worked out, the read carries on in the cache, and the next question finds it, so the first person to ask about a month gets "ask again in a few minutes".
* **What is not covered.** The root cause of a problem is not data in Zabbix and is never guessed. What the user's pages do not show is not read, and what the caches hold is up to a few minutes old.
* **The FOCUS block now carries more kinds of text from Zabbix.** All of it passes `promptText` and sits inside the data fence, as the rest does, and it is a surface to keep reviewing.
