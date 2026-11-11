# 37. What changed on 19 October 2026, the check and six rows

[setup.md](../../setup.md) · previous: [§36](36-what-changed-on-16-october-2026-the-folders.md) · next: [§38](38-what-changed-on-19-and-20-october-2026-the-splits-the-linter-and-the-screenshots.md)

*Three rounds on one day. You pasted the "Not checked" list of [`tracker.md`](../../tracker.md) and asked me to check it and update the documents. Then you said "tolong perbaiki" under the four findings, and later "tolong apply IN 28, FR-13, IN-11, BK-13, FR-16", and "sama UX 20 ya". The first two rounds are in the commit `0044efe`, which you pushed that morning together with the work of 15 and 16 October. The third was not committed when this was written. None of it is in the running portals, which still have the build of 14 October.*

## The check of the list

I read the list again, line by line, against the running portals, GitHub, the BFF logs and a throwaway portal, and changed no code and no running container. How it was done is in the tracker (the section "Check of the not-checked list"); the findings are these.

* **One line was wrong.** "Nobody signed in" was not true. The BFF log of :8081 shows sign-ins on 15 October (08:39) and 16 October (14:43 WIB), 26 reads of the Internet traffic meters, the SLA page, one Explain and one report download (both answered 200), and one Assistant question on 16 October at 14:44. :8082 had none since its rebuild.
* **The Anthropic key of :8081 is refused.** The Explain of 15 October worked, and the Assistant question of 16 October got a 401, `invalid x-api-key`, from Anthropic. The container was not recreated in between, so the key was revoked or disabled on Anthropic's side. Explain and the Assistant of that portal answer nothing until a valid key is in `.env` and the BFF is recreated (SC-01, yours to do: I do not open `.env`).
* **What closed without a password.** The dependency audits (nothing in all four packages), both images and `nginx -t` as `ci.yml` builds them, `npm run verify` in both copies, the `.env` modes (all 600), the hardening of the running containers, and axe 4.13.0 on 151 page runs: every page for the administrator, the operator and the viewer in both themes at 1440 px, the administrator at 390 px, and the sign-in screen.
* **The old Zabbix token of `cb97069`, tried once with your word.** The Zabbix at :8080 refused it ("Not authorized"). That says nothing about any other Zabbix that issued it; revoking it wherever it exists is still yours (SC-06), and the repository was still public.
* **The first run of `ci.yml` at GitHub**, for the push of `0044efe`: the file is accepted and lists its five jobs, and none of them started, because of the billing lock (IN-30).

## Four findings, fixed (CK-01 to CK-04)

* **CK-01, a table the keyboard cannot reach.** At 390 px six pages had a sideways-scrolling table that axe says a keyboard cannot reach (Chrome 155 does reach it with Tab, other browsers may not). The 19 table boxes are now one component, `web/src/shared/components/TableWrap.tsx`: while a box holds more than it shows, it has `tabindex="0"`, `role="region"` and a name, and it loses them when it stops scrolling. You said the NOC does not use only Chrome, so the markup no longer leans on it.
* **CK-02, the sign-in screen is a `<main>`.** It was the only screen without the landmark.
* **CK-03, a refused AI key has its own sentence.** It read "Try again in a moment" for a fault that trying again cannot cure. A 401 or 403 from the model now says "The AI service did not accept the portal's key. Trying again will not help; tell an administrator.", and the log says which key to replace.
* **CK-04, the audit scripts' page lists.** `/devices` was missing from the default lists of `page-audit.mjs` and `layout-sweep.mjs`. A new test, `live-tools.test.ts`, fails when a page of the app is missing from either.

Seven server tests and ten web tests were added. Each fix was broken on purpose and the test named for it failed. Axe on the same 151 page runs found nothing after the fixes.

## Six rows applied

* **IN-28, the rollback images.** §23 now has the rule: keep the newest two tags of each of the four images and remove the rest once the build after them has run for a day. At your word the 12 old tags (`2oct`, `7oct` and `13oct` of each image) and the volume `proto1_pgdata`, which held the demo estate, were removed, and the demo estate is gone for good. Docker's images went from 33 entries to 21 and from 12.53 to 12.38 GB: little came back, because the layers of an old tag are shared with a newer one.
* **IN-11, the live stream is compressed.** A screen that accepts gzip gets the frames compressed by the BFF itself, with a sync flush after every frame so that none waits in a buffer. Through the nginx of the web image, on HCML's real list, the first frame went from 166,845 to 18,693 bytes on the wire (89 percent fewer), arrived as fast as before, and headless Chrome decoded it (§7). The Problems page opens the same stream and reads its list again at once when a frame says it changed; it still polls every 30 s. The stream hook moved to `shared/hooks/useSSE.ts`.
* **BK-13, a graph range in whole minutes.** An explicit `from` and `to` of `/api/graph` are widened to whole minutes (`from` down, `to` up) after the range is checked as it was asked, so requests seconds apart share one cached read (§9).
* **UX-20, the six server sentences.** The sentences that said "Details are in the BFF log" or named a setting now say the same plain thing to everyone, "Tell an administrator", with a reference for an unexpected error; the setting goes to the log (§13). `plain-wording.test.ts` holds it.
* **FR-16, the web's types held to the OpenAPI file.** The explain answers, which a model writes, are checked at run time like every other answer. `openapi-typescript`, a dev dependency of `web/`, makes `web/src/generated/openapi.ts` from `docs/api/openapi.yaml`, and a test makes `npm run typecheck` fail where the file promises less than the app's types need. The first run found 20 of the 36 answers the app reads disagreeing with the file, never because of the app: in 7 the file contradicted what the server sends, in 13 it was less exact. The file was corrected against the server's own types, 19 descriptions that YAML had silently cut at a comma were quoted, and the file as committed in `0044efe` turned out not to be valid YAML in two places. The corrected file was tried on 40 real answers of HCML's restored data, and all 40 fit.
* **FR-13, the example user name.** All four `.env.example` templates already say `PORTAL_USER=admin` (only those lines were read), so there was nothing to change.

## Numbers

Server 1,685 tests in 78 files and web 1,153 in 80 at the end of the day, with the type comparison on top, which the typecheck runs. 17 deliberate breakages of IN-11, BK-13, UX-20, the explain guards and the type check were each caught.
