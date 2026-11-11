# Backing up and restoring the portal

The portal keeps no estate data, but it does keep its settings, and nothing else holds a copy of
them. They are in the `.env` files. Git ignores those files on purpose, because they hold passwords
and tokens, so a clone of the repository does not bring them back. This page says what to keep, how
to keep it, and how to start again from it. It corrects an older claim in
[`../index.md`](../index.md) and [ADR-0003](../architecture/adr/0003-no-database.md) that there is
"nothing to back up" (tracker IN-24).

## The logs: what they hold, where they go, how long they last

The portal's own record of who did what is its log, one JSON line for each event, and it is the only one: the portal has no audit table.
What it holds, by name and never by content: each sign-in (`sign_in`, with the name as typed and the outcome), each acknowledge or
close (the user, the address, the event ids and the action), each use of the AI (`ai_call`: who, the kind, how it ended, the tokens), each report
download (`report_download`) and each report email (`report_email`: who or `schedule`, the month, the formats, how many it reached and the
domains they are in), each change to the schedule (`report_schedule_changed`) and each change or deletion of the saved list
(`report_recipients_saved`, `report_recipients_deleted`, by how many and never which). No line holds a question, an answer, a file, a
password, a token, or the address of a person a report goes to. A page a person opened is not a line of its own: the request line carries
the method, the path and the address, and not the user (tracker SC-42, kept as it is).

Where it goes. Docker's `json-file` driver keeps up to five files of 50 MB for each container and overwrites the oldest, and **deletes them
when the container is made again**, which every rebuild does. `deploy/rebuild.sh` therefore saves a compressed copy of each copy's logs first, to
`~/.local/state/hcml-portal-logs` (`LOG_ARCHIVE_DIR`), the newest 30 of each copy (`LOG_ARCHIVE_KEEP`), readable by the user who runs it alone.
That is the whole of the keeping: a copy on the same Mac, and nothing outside it.

What is still open, and is HCML's to decide (SC-42): where the container logs go so that they outlive the machine (a volume, or HCML's log server, by
a different Docker logging driver), for how long they are kept, and who may read them. The names typed at sign-in, the addresses people sign in
from and the domains of the people a report goes to are personal data, and a mistyped password can end up in the name box and so in the log.
The question to HCML IT is written down in `myown/documents/notes/hcml-it-log-keeping-question-2026-11-11.md`; the portal changes nothing until it is answered.

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
| The saved recipients, the monthly schedule and a record of the last 24 sends | `portal-state.json` in the Docker volume `portal-state` (`hcml-portal` only) | No | Optional: addresses, a schedule and counts. Losing it means setting the schedule again and, at worst, one month sent twice |

The `docker-compose.yml` of `hcml-portal` declares one volume, `portal-state`, for the small file in the last row above
([ADR-0015](../architecture/adr/0015-keep-a-small-state-file-for-recipients-and-the-schedule.md)); that of `hcml-portal-ollama` declares
none, so there is no portal data folder to copy there. `docker compose down -v` deletes the volume, so do not run it with `-v` unless that is meant. To keep the
file, copy it out to a folder outside the repository, because it holds addresses and git does not ignore it: `mkdir -p ~/hcml-backup && docker run --rm -v hcml-portal_portal-state:/data:ro -v ~/hcml-backup:/backup alpine sh -c 'cp /data/portal-state.json /backup/ && chown "$1:$2" /backup/portal-state.json' sh "$(id -u)" "$(id -g)"`. The `chown` hands the copy to the person who made it: without it, Docker Engine on Linux leaves a file owned by root with mode 0600 in their folder, which they cannot read without `sudo`. Running the copy as one's own id (`--user "$(id -u):$(id -g)"`) does not work, because the portal's file is mode 0600 and belongs to the portal's user; both forms were tried on a throwaway volume on Docker Desktop for Mac (IN-70), and not on Docker Engine on Linux. To put it back, stop the portal (`docker compose stop portal-bff`), copy the file in as the portal's own user, `docker run --rm --user 1000:1000 -v hcml-portal_portal-state:/data -v ~/hcml-backup:/backup alpine cp /backup/portal-state.json /data/`, and start it again (`docker compose start portal-bff`). A file written by root has mode 0600 and the portal cannot read it. Each copy of
the portal has its own `.env` files, and each needs its own backup. `hcml-portal-ollama` is not
under git at all (checked 7 October 2026: there is no `.git` folder in it), so its compose file, its
documents and its `.env.example` files are not versioned either. Copy that whole folder, leaving out
`node_modules` and `dist`.

## Keep an encrypted copy

Make a new copy after every change to a user, a role, a token, `JWT_SECRET` or a setting. An old copy
that holds a user's old password is a copy that restores the wrong thing.

```bash
# From the repository root. Each command asks for a passphrase twice.
# Write outside the repository folder: git does not ignore a file named .env.enc or .env.gpg.
mkdir -p ~/hcml-backup
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -in .env \
  -out ~/hcml-backup/hcml-portal.env.$(date +%F).enc
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -in server/.env \
  -out ~/hcml-backup/hcml-portal.server-env.$(date +%F).enc
```

In `hcml-portal-ollama`, use `hcml-portal-ollama` in the file names so the two never mix.

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

1. **Get the code.** `git clone` for `hcml-portal`. For `hcml-portal-ollama`, restore the folder you
   copied. A clone holds only what was committed: the live builds of 2 November were made from a working tree that is
   ahead of the last commit, and `hcml-portal-ollama` is not under git, so keep a copy of each beside the encrypted
   files (a `git bundle` and a tar of the folder, without the `.env` files) on another machine (tracker IN-50).
2. **Put the files back and lock them.** From the repository root:
   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in ~/hcml-backup/hcml-portal.env.2026-10-07.enc -out .env
   chmod 600 .env
   ```
   Do the same for `server/.env` if you use a development run.
3. **Compare the names.** Open `.env.example` beside `.env`: a setting named in one and missing from
   the other is a question to answer. Then read [`deploy/settings.example`](../../deploy/settings.example)
   for the non-secret settings and their defaults, and check that the values you changed from them
   are still in `.env`.
4. **Check that compose accepts it.** `docker compose config --quiet` prints nothing when all is
   well. It stops with an error naming `JWT_SECRET` when the signing secret is missing.
5. **Start it.** `docker compose up -d --build`.
6. **Check it is up.** `curl localhost:8081/bff/api/health` (8082 for `hcml-portal-ollama`) answers
   `"ok":true` when the BFF is running. `docker compose logs portal-bff` shows why, in plain words,
   if the BFF refused to start: a placeholder `JWT_SECRET`, or a user with an empty password.
7. **Sign in as each user once.** A mistake in `PORTAL_USERS` shows here. Then, in a tab that is
   signed in, open `/bff/api/health` on the same address: `ready.ok` is `true` when Zabbix accepted
   the token, and says why when it did not. The `curl` above shows `ready` too, as a plain `true` or
   `false`. Do not press Acknowledge as a test: it writes to the production Zabbix.
8. **Open the SLA page for a past month.** The first request after a start rebuilds the figures from
   Zabbix and takes a while.
9. **Make a fresh encrypted copy** if you changed anything while restoring.

Run steps 1 to 6 once into an empty folder before you need them. A restore that has never been tried
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
- The model key: a new one from the provider, for the hosted copy. The local copy needs none.
- The other settings: the defaults are in [`deploy/settings.example`](../../deploy/settings.example).
  Anything HCML had changed from them, such as the site settings, the trigger names behind the SLA
  or `NET_GROUP_IDS`, has to be remembered or worked out again. That is why the encrypted copy is
  worth more than the settings file.

## What this does not cover

Zabbix's own database and its backup. The Docker images, which are rebuilt from the code. And, if
you add a TLS proxy ([`tls.md`](tls.md)), its certificate store: Caddy and Traefik keep one, and the
certificates can be issued again. On a development laptop that runs the restored Zabbix stack, the `.env` beside
its `docker-compose.yml` holds the two MySQL passwords (since 12 October 2026) and needs the same care.
