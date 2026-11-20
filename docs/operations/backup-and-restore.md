# Backing up and restoring the portal

The portal keeps no estate data, but it does keep its settings, and since 17 November 2026 the accounts made on the Users page,
and nothing else holds a copy of either. The settings are in the `.env` files, which git ignores on purpose, because they hold passwords
and tokens, so a clone of the repository does not bring them back. The accounts are in the Docker volume `portal-state`, which a clone does not hold either, and
`docker compose down -v` deletes. Keep both together: `deploy/backup-state.sh --env` makes one encrypted copy of the volumes (the users, the recipients, the schedule, the closed months and the log)
and a second of the settings files. This page says what to keep, how to keep it, and how to start again from it; the logs, which are the third thing, are the last section. It corrects an older claim in
[`../index.md`](../index.md) and [ADR-0003](../architecture/adr/0003-no-database.md) that there is
"nothing to back up" (tracker IN-24).

## What the portal keeps

| What | Where | In git? | What to do |
|---|---|---|---|
| The users and their roles, the Zabbix read and write tokens, the model key, `JWT_SECRET`, and the SLA and site settings | `.env` in the repository root, which `docker compose` reads | No, ignored | Keep an encrypted copy (below) |
| The same, for a development run | `server/.env`, which `npm run dev` reads | No, ignored | An encrypted copy too, if you use it: it holds a Zabbix token |
| The name Zabbix answers to on this machine | `docker-compose.override.yml` beside the compose file, in each folder | No, kept out of git | A plain copy is enough: it holds an address and no secret. Without it every read of Zabbix fails until it is written again from the address HCML IT gives |
| The names of the settings, with no real value | `.env.example` in the root and in `server/` | Yes | Nothing: templates, which must never hold a real value |
| The non-secret settings and their defaults | [`deploy/settings.example`](../../deploy/settings.example) | Yes | Nothing: already versioned |
| Hosts, problems, history, the figures behind the SLA | Zabbix's own database | Not here | Zabbix's own backup. The portal only reads it |
| Cached answers | The BFF's memory | No | Nothing: rebuilt on demand, and gone on every restart |
| The saved recipients, the monthly schedule and a record of the last 24 sends | `portal-state.json` in the Docker volume `portal-state` (both copies) | No | Optional: addresses, a schedule and counts. Losing it means setting the schedule again and, at worst, one month sent twice |
| The people who sign in, added on the Users page: names, roles, pages, and the Argon2id hashes of their passwords | `users.json`, and `users.json.prev` (the version before the last change), in the same volume `portal-state` (both copies) | No: a Docker volume, and `.gitignore` names `users.json*` too | Worth keeping: losing it means adding those people again. The break-glass administrator of `.env` can still sign in and add them. The file holds password hashes, so the copy is treated as a secret and kept encrypted (ADR-0017) |
| The requests for an account that people left on the sign-in page (FR-62), when `ACCOUNT_REQUESTS` is on | `requests.json`, in the same volume `portal-state` (both copies) | No: a Docker volume, and `.gitignore` names `requests.json*` | Optional: names and reasons that strangers typed, kept at most 30 days and, unless `ACCOUNT_REQUESTS_MAX_PENDING` says otherwise, never more than 50 at once. The file is personal data, so a copy of the volume is kept encrypted. Losing it means that those people ask again |
| The web check figures of the months that have closed, as first read | `closed-months.json` in the same volume `portal-state` (both copies) | No | Optional: a few scenario names and percentages for each of the last 36 months. Losing it loses nothing that cannot be taken again, only the claim that a figure is the old one: the next read of a closed month keeps what Zabbix says then, and the page says the day (ADR-0016) |
| The server's own copy of its log | `bff.log` and `bff.log.1` and up, in the Docker volume `portal-logs` (both copies) | No, ignored | As HCML decides (SC-42, above): it holds the account names that signed in, and addresses. A rebuild keeps it; nothing here is needed to run the portal |

The `docker-compose.yml` of each copy declares two volumes, `portal-state` for the small files of the state rows above
([ADR-0015](../architecture/adr/0015-keep-a-small-state-file-for-recipients-and-the-schedule.md), [ADR-0016](../architecture/adr/0016-keep-the-web-check-figures-of-closed-months.md), [ADR-0017](../architecture/adr/0017-keep-the-portals-users-in-a-file-of-their-own.md)) and `portal-logs` for the log. `docker compose down -v` deletes the volumes, and with them every account made on the Users page, so do not run it with `-v` unless that is meant.
The scripts of the next section copy both volumes and find their names themselves. By hand, as a fallback when a script cannot run, the volume is named by the copy: `hcml-portal_portal-state` for `hcml-portal` and `hcml-portal-ollama_portal-state` for `hcml-portal-ollama` (`docker volume ls` lists them), and `docker run -v <a name Docker does not know>` makes a new empty volume, so a copy from a wrong name succeeds and copies nothing: look at what arrived. To copy a file out by hand to a folder outside the repository:
`mkdir -p ~/hcml-backup && docker run --rm -v hcml-portal_portal-state:/data:ro -v ~/hcml-backup:/backup alpine sh -c 'cp /data/portal-state.json /backup/ && chown "$1:$2" /backup/portal-state.json' sh "$(id -u)" "$(id -g)"`.
The `chown` hands the copy to the person who made it: without it, Docker Engine on Linux leaves a file owned by root with mode 0600 in their folder, which they cannot read without `sudo`. Running the copy as one's own id (`--user "$(id -u):$(id -g)"`) does not work.
A plain copy of `users.json` holds password hashes and of `requests.json` the names of strangers: keep either only in the encrypted file of the script.
The portal has its own `.env` files, and each needs its own backup. `hcml-portal-ollama` has a git repository of its own since
11 November 2026, which ignores its `.env` files and its `docker-compose.override.yml` as the other does, so those two need the backup in either copy.

## The volumes, with a script

`deploy/backup-state.sh` makes one encrypted file of the two volumes of a copy, `portal-state` (the users, the recipients, the schedule, the closed months) and `portal-logs`, and `deploy/restore-state.sh` puts it back. They work on the copy whose folder they sit in. The volumes are read through the portal's own image, which has `tar`, so nothing is pulled and nothing is installed on the machine, and the file is never a plain file on the disk: the archive goes through `openssl` as it is made.

```bash
deploy/backup-state.sh                       # the volumes, into ~/hcml-backup (BACKUP_DIR)
deploy/backup-state.sh --env                 # and a second file of .env, server/.env and docker-compose.override.yml
deploy/backup-state.sh --check FILE          # opens a copy, tests it, lists what it holds; writes nothing
deploy/restore-state.sh FILE                 # lists what a copy holds; changes nothing
deploy/restore-state.sh FILE --apply         # writes it into the volumes, which must not be running
```

The passphrase is typed once, and once more when a copy is made so that a slip is caught (the script says so; it does not ask again for the read-back, and a typed passphrase is held in the script's memory and never written to a file or put into a command line), or it is read from the file that `BACKUP_PASSPHRASE_FILE` names (readable by you alone, and not kept in the folder of the copies). A copy is opened again before it is kept, and a damaged one is refused, which the encryption alone would not notice (the note on damage below); a copy that failed is not left behind as a `.partial` file. `BACKUP_KEEP` (default 14) is how many copies of the volumes are kept, and must be a whole number of 1 or more: 0 or a word is refused before anything is copied, since 0 would delete the copy just made. The folder of the copies is made with mode 0700 when the script makes it, and a folder that was there already is left as it was: where Zabbix watches the age of the newest copy (the runbook, step 8), make the folder first with `install -d -m 750 -g zabbix <folder>`, since an agent that runs as another user cannot read a folder of mode 0700 and the probe then says that it cannot. Each file has a `.sha256` beside it. A file made with `--env` holds the tokens and the signing secret: keep its passphrase apart from the file.

To restore, the containers have to exist and be stopped, so that nothing writes while the files come back: `docker compose stop` on a machine that runs, and `docker compose up --no-start` on a new one, which makes the containers and empty volumes. Then `deploy/restore-state.sh FILE --apply`, then `docker compose up -d`, and sign in as a restored user. A file in the copy replaces the file of the same name in the volume, and a file only the volume has is left alone. Each file of the state volume that is replaced is first copied beside itself as `<name>.before-restore` (`users.json.before-restore` and so on; the copy of an earlier restore is overwritten), so that a restore of the wrong copy can be undone by hand: put the `.before-restore` file back over the file with `docker run --rm -v hcml-portal_portal-state:/data alpine sh -c 'cd /data && mv users.json.before-restore users.json'` while the portal is stopped. The commands run from the folder of the copy, so a `COMPOSE_FILE` line in its `.env` (the virtual machine, [the runbook](vm-runbook.md) step 5) names the same files as for every other command.

What the tests of the two scripts show (`state-backup.test.ts`, with the real `openssl`, `tar` and `gzip` and a stand-in for Docker): the file holds none of the plain text and is not a gzip file, a wrong passphrase opens nothing, the oldest copies beyond the number to keep are deleted with their checksums, a bad `BACKUP_KEEP` is refused, a typed passphrase is read once and never reaches a file or a command line, a failed read leaves no partial file, a restore refuses while the portal runs (which is how Docker reports a paused or a restarting container too) and writes nothing for a wrong passphrase, it keeps what it replaces, and what comes back equals what went in. Run against a real stack, they are step 7 of [the runbook](vm-runbook.md).

**Every night, on this Mac.** A LaunchAgent of the account, `id.hcml.portal-backup` (`~/Library/LaunchAgents/id.hcml.portal-backup.plist`), runs `deploy/backup-state.sh` for each copy at 02:30. Its program is `/bin/bash -c` with a line that sets `BACKUP_PASSPHRASE_FILE` to a file of mode 600 outside the folders of the copies and loops over `hcml-portal` and `hcml-portal-ollama`; its `PATH` holds Docker's folder (`~/.docker/bin`), its `StartCalendarInterval` is hour 2 and minute 30, and its output goes to `~/.local/state/hcml-portal-backup/`. `launchctl bootstrap gui/$(id -u) <the plist>` loads it, and `launchctl bootout` removes it. A Mac that is switched off at 02:30 skips that night, and one that is asleep runs it when it wakes. The copies stay on this Mac's disk: a copy off the Mac, and the passphrase kept apart from it, are still to be made (IN-50).

## Keep an encrypted copy

Make a new copy after every change to a user, a role, a token, `JWT_SECRET` or a setting. `deploy/backup-state.sh --env` does the files of this section as one encrypted file, and the commands below do the same by hand. An old copy
that holds a user's old password is a copy that restores the wrong thing.

```bash
# From the repository root. Each command asks for a passphrase twice (typed, and typed again).
# Write outside the repository folder: a tar or rsync of the folder would carry the copy along.
mkdir -p ~/hcml-backup
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -in .env \
  -out ~/hcml-backup/hcml-portal.env.$(date +%F).enc
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -in server/.env \
  -out ~/hcml-backup/hcml-portal.server-env.$(date +%F).enc
```

In `hcml-portal-ollama`, use `hcml-portal-ollama` in the file names so the two never mix.

`docker-compose.override.yml` is in no repository, and the copies above do not hold it. It names an address and holds no secret, so a plain copy beside them is enough:
`cp docker-compose.override.yml ~/hcml-backup/hcml-portal.override.$(date +%F).yml`. Make one for each copy of the portal, and again after each change to the file.

Then:

- Copy the encrypted files off this computer: a second machine, or a drive kept somewhere else.
  A backup on the laptop is lost with the laptop.
- Keep the passphrase somewhere else, such as a password manager. A passphrase written beside
  the file is no protection.
- Check a copy opens, without writing the plain file to disk or showing it. This prints the
  number of lines in it, and `bad decrypt` means a wrong passphrase:
  `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in ~/hcml-backup/hcml-portal.env.2026-10-07.enc | wc -l`
  It does not mean a damaged file. This kind of encryption has no check on the file, so a file damaged in the
  middle opens without an error and gives one garbled line (a bit flipped in a made-up copy gave no error and 29 of
  30 lines). To catch damage, write down `shasum -a 256 .env` when you make the copy (`sha256sum` on Linux) and
  compare it with the same command on the plain file after a test restore, or use `gpg --symmetric`, which checks the file.
- Keep the plain files readable by you alone. On a Mac, `stat -f %Lp .env server/.env` prints
  `600` for each (on Linux, `stat -c %a .env server/.env`); `chmod 600 .env server/.env` sets it (SC-25), and a new
  `.env` made with `cp .env.example .env` needs it too. Compose and `npm run dev` read them as
  you, so nothing changes. Any other account on the machine can read a file that shows `644`.
- Never send the plain file by email or chat, and never commit it. `.env.example` is the only
  file with this kind of name that git should hold, and it must never hold a real value.

`gpg --symmetric --cipher-algo AES256` does the same job, as does a password manager that stores
files, or an encrypted disk image. What matters is that the copy is encrypted and is not on the same
machine.

## Restore checklist

1. **Get the code.** `git clone` for each copy: `hcml-portal`, and `hcml-portal-ollama`, which has had a repository
   of its own since 11 November 2026. A clone holds only what was committed, and a live build can be made from a working tree
   that is ahead of the last commit (its label ends in `-dirty`), so keep a copy of each beside the encrypted
   files (a `git bundle` and a tar of the folder, without the `.env` files) on another machine (tracker IN-50).
2. **Put the files back and lock them.** From the repository root:
   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in ~/hcml-backup/hcml-portal.env.2026-10-07.enc -out .env
   chmod 600 .env
   ```
   Do the same for `server/.env` if you use a development run. Then put `docker-compose.override.yml` back beside the compose file in each folder, from the plain copy kept with
   the encrypted ones. With no copy, write it again from the form on [the restart page](after-a-restart.md) with the address HCML IT gives you. Without it every read of Zabbix fails from
   HCML's network.
3. **Compare the names.** Open `.env.example` beside `.env`: a setting named in one and missing from
   the other is a question to answer. Then read [`deploy/settings.example`](../../deploy/settings.example)
   for the non-secret settings and their defaults, and check that the values you changed from them
   are still in `.env`.
4. **Check that compose accepts it.** `docker compose config --quiet` prints nothing when all is
   well. It stops with an error naming `JWT_SECRET` when the signing secret is missing.
5. **Put the accounts back.** The users made on the Users page, the recipients, the schedule and the closed months are in the volume `portal-state`, which a clone does not hold. On a new machine make the containers and the empty volumes without starting them (`docker compose up --no-start`; on one that runs, `docker compose stop`), then `deploy/restore-state.sh FILE --apply` with the copy of the volumes that `deploy/backup-state.sh` made (it asks for the passphrase and keeps what it replaces as `<name>.before-restore`). Leave this step out and the only account is the administrator of `.env`, who adds the people again.
6. **Start it.** `docker compose up -d --build`.
7. **Check it is up.** `curl localhost:8081/bff/api/health` (8082 for `hcml-portal-ollama`) answers
   `"ok":true` when the BFF is running. `docker compose logs portal-bff` shows why, in plain words,
   if the BFF refused to start: a placeholder `JWT_SECRET`, or a user with an empty password.
8. **Sign in as each user once.** A mistake in `PORTAL_USERS` shows here. Then, in a tab that is
   signed in, open `/bff/api/health` on the same address: `ready.ok` is `true` when Zabbix accepted
   the token, and says why when it did not; with a token that is right and `ready.zabbix` not `ok`, look first at `docker-compose.override.yml` (step 2). A person made on the Users page signs in too, with the password they had. The `curl` above shows `ready` too, as a plain `true` or
   `false`. Do not press Acknowledge as a test: it writes to the production Zabbix.
9. **Open the SLA page for a past month.** The first request after a start rebuilds the figures from
   Zabbix and takes a while.
10. **Make a fresh encrypted copy** if you changed anything while restoring.

Run steps 1 to 7 once into an empty folder before you need them. A restore that has never been tried
is a guess.

## If there is no copy

Nothing in `.env` can be read back from the portal. All of it can be made again:

- `JWT_SECRET`: a new value, for example from `openssl rand -hex 32`. Every signed-in session
  ends, which is the only cost.
- The Zabbix tokens: a Zabbix administrator makes them again (*Users → API tokens*): a read-only
  one for `ZABBIX_API_TOKEN`, and a separate one for `ZABBIX_WRITE_TOKEN` if acknowledge and close
  should work. Leave the write token blank to keep the portal strictly read-only. If the loss may
  have been a leak, delete the old tokens in Zabbix as well.
- The users: `PORTAL_USERS` as `name:password:role` triples. Choose new passwords and tell the
  people. A password may be stored as a hash instead of plain text (`server/scripts/hash-password.ts`),
  which keeps the plain password out of the backup. The script runs with Node, from `server/` after `npm ci`
  (`npx tsx scripts/hash-password.ts`); the images do not hold it, so a server with only Docker needs a checkout for this step.
- The people made on the Users page, the recipients, the schedule: they were in the volume `portal-state`, and without a copy of it they are made again. The administrator of `.env` signs in and adds the people on the Users page, with new temporary passwords; the recipients and the schedule are set again in the report dialog. Nothing else is lost.
- The model key: a new one from the provider, for the hosted copy. The local copy needs none.
- The other settings: the defaults are in [`deploy/settings.example`](../../deploy/settings.example).
  Anything HCML had changed from them, such as the site settings, the trigger names behind the SLA
  or `NET_GROUP_IDS`, has to be remembered or worked out again. That is why the encrypted copy is
  worth more than the settings file.

## The logs: what they hold, where they go, how long they last

The portal's own record of who did what is its log, one JSON line for each event, and it is the only one: the portal has no audit table.
What it holds, by name and never by content: each sign-in (`sign_in`, with the account's name, or `unknown` for a name no account holds, and the outcome), each acknowledge or
close (the user, the address, the event ids and the action), each use of the AI (`ai_call`: who, the kind, how it ended, the tokens), each report
download (`report_download`) and each report email (`report_email`: who or `schedule`, the month, the formats, how many it reached and the
domains they are in), each change to the schedule (`report_schedule_changed`) and each change or deletion of the saved list
(`report_recipients_saved`, `report_recipients_deleted`, by how many and never which). No line holds a question, an answer, a file, a
password, a token, or the address of a person a report goes to. A page a person opened is not a line of its own: the request line carries
the method, the path and the address, and not the user (tracker SC-42, kept as it is).

Where it goes. Docker's `json-file` driver keeps up to five files of 50 MB for each container and overwrites the oldest, and **deletes them
when the container is made again**, which every rebuild does. `deploy/rebuild.sh` therefore saves a compressed copy of each copy's logs first, to
`~/.local/state/hcml-portal-logs` (`LOG_ARCHIVE_DIR`), the newest 30 of each copy (`LOG_ARCHIVE_KEEP`), readable by the user who runs it alone.
The server also writes its own copy of its log, the same lines, to a file in a volume, `portal-logs` at `/var/log/portal` in the container: `bff.log`, and
`bff.log.1` and up for the older ones. A file is closed at 20 MB (`LOG_FILE_MAX_MB`) and the oldest of ten (`LOG_FILE_KEEP`) is dropped, so the folder holds
about 200 MB at most. The volume outlives a rebuild, since a rebuild makes the containers again and not the volumes. `docker compose down -v` deletes it, and
so does removing the volume by hand. To read the end of it: `docker compose exec portal-bff tail -n 50 /var/log/portal/bff.log`. It holds the server's
lines, which are the ones that say who did what; nginx's access lines are in Docker's log only. A volume is still on the same machine: it does not outlive the disk.
When the disk of the machine fills, [`full-disk.md`](full-disk.md) says what is likely to have filled it and what is safe to remove.

What is still open, and is HCML's to decide (SC-42): where the logs go so that they outlive the machine (HCML's log server, which can collect that folder or take
Docker's own log by a different logging driver), for how long they are kept (the two numbers above set a size, not a time), and who may read them. The account names that signed in, the addresses people sign in
from and the domains of the people a report goes to are personal data. A build from SC-52 (15 November 2026) writes `unknown` and the length for a name that no account holds, so a
password typed into the name box is not kept; lines written by an older build can hold one.
The question to HCML IT is written down in `myown/documents/notes/hcml-it-log-keeping-question-2026-11-11.md`; the portal changes nothing more until it is answered.

## What this does not cover

Zabbix's own database and its backup. The Docker images, which are rebuilt from the code. And, if
you add a TLS proxy ([`tls.md`](tls.md)), its certificate store: Caddy and Traefik keep one, and the
certificates can be issued again. On a development laptop that runs the restored Zabbix stack, the `.env` beside
its `docker-compose.yml` holds the two MySQL passwords (since 12 October 2026) and needs the same care.
