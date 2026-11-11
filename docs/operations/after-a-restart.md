# After a restart: what comes back, and how to look

The portals read HCML's Zabbix over HCML's office network (option B, since 29 October 2026). This Mac runs
only the four portal containers. The copy of Zabbix they read before, a separate compose project on this Mac
(`Proto1/docker-compose.yml`, project `proto1`), was taken down that day.

## What comes back by itself

| Container | Restart policy | Why |
|---|---|---|
| The two containers of each portal | `unless-stopped` | Set when the containers were hardened (setup §23) |

`unless-stopped` means that a container someone stopped by hand stays stopped when Docker restarts. To
undo it on one container: `docker update --restart no <name>`.

## What has to be true first

- Docker has to start. On a Mac that is Docker Desktop's setting "Start Docker Desktop when you sign in",
  and the Mac has to be signed in. Without it nothing comes back. This repository cannot read or set it.
- The Mac has to be on HCML's office network, where Zabbix's LAN address answers. Off it, the portals come
  back and say that Zabbix cannot be read. Nothing false is recorded meanwhile, because HCML's own Zabbix
  keeps collecting.
- Each portal folder needs its `docker-compose.override.yml`. From the office network the name
  `zabbix.hcml.co.id` leads to a Zero Trust gateway that refuses the portal, so the file maps the name to
  Zabbix's LAN address for `portal-bff`, and the certificate is still checked against the name. The file
  names an internal address, so it stays on the machine: `.git/info/exclude` keeps it out of git, and
  `docker compose` reads it by itself. Its form, with a placeholder where the address goes (Compose adds the line to the one in
  `docker-compose.yml`, so `host.docker.internal` stays):

  ```yaml
  services:
    portal-bff:
      extra_hosts:
        - "zabbix.hcml.co.id:<Zabbix's LAN address>"
  ```

## How long it takes

HCML's Zabbix is slow on large reads: on 29 October 2026 most pages took 20 to 100 s and the Capacity
report 256 s, because its database had little memory to work with. The BFF now asks for less and keeps
what it read:

- the problem list leaves out the operational data, which Zabbix fills one problem at a time (0.9 s
  against 35 to 46 s), and names the hosts of known triggers from memory;
- the ping items are listed once an hour, and their values read in two history reads (2.8 s against
  54.5 s); the Dashboard's item and trigger counts are kept an hour and read in the background;
- the slow views answer at once from their last copy while a newer one is read, and say how old it is
  once that is two minutes; a Capacity run is kept an hour, and after that its report is shown at once,
  for up to a day, while the next run is built;
- right after a start, the BFF reads the main of these views once, one at a time (`services/warmUp.ts`), so
  the first visitor finds them ready. The BFF's log says `warm-up: done` when it has finished.

That leaves pages that still wait on HCML's Zabbix. Measured on 30 October with the admin account, a first visit
right after a start took 62 s for the noise report, 52 s for Services, 39 s for the availability report, 38 s for
the SLA page, 33 s for the Dashboard's busiest hosts and 20 s for Graphs (before BK-25), and the 19 pages together 269 s; a few
minutes later the same pages took 34 s in all. After ten minutes with nobody there they wait again (the reports keep
their last copy only four minutes): the availability report 58 s, the noise report 48 s, the Dashboard 30 s, Graphs
15 s (before BK-25) and Network 11 s. Graphs waited 15 to 22 s on every visit until 30 October, because its item list asked
Zabbix for each item's last value one by one (tracker BK-25); it no longer does and opens in about 1 s.
Until HCML IT has changed its database settings (IN-41), that wait is HCML's.

The limits stay generous for what is still slow: one read 300 s (`ZABBIX_TIMEOUT_MS`), a page 330 s and
nginx 360 s, and the SLA, its download and an explanation 450 s, with nginx at 480 s. Everything is kept
in memory only, so a restart starts the warm-up again.

## Who notices when a portal goes down

Docker restarts a dead container, but tells nobody. `deploy/watch.sh` does, from outside Docker: every
minute it asks each portal's `/bff/api/health` and `docker inspect`s its containers, and it says so once
when a portal stops answering for two checks in a row, answers again, turns unhealthy, stays stopped, paused, dead, created, restarting or being
removed for two checks in a row, restarts in a loop, or when Docker itself stops answering for two checks in a row. A portal that answers but says `ready: false` in its health reply is up and cannot read Zabbix: it is told on the second check in a row too, and again when it can (IN-47; the reply says it to anyone, so the watcher needs no account). A call to Docker that takes longer than
`WATCH_DOCKER_TIMEOUT` seconds (20 by default) counts as Docker not answering, so a Docker Desktop that hangs
is reported and does not hold the run. The notification has the same limit, so a mail command that waits on a stalled relay does not hold it either (IN-68): it is stopped, logged as failed, and tried again at the next check. A run that finds another one under way stops at once (a lock in the state folder), so a timer that starts one every minute cannot pile them up, and the watcher looks for `docker` in `~/.docker/bin` too, where Docker Desktop puts it. A change is recorded as told only when the notification went through: if `WATCH_NOTIFY_CMD` exits with an error, for example because the mail relay is down, the next check says it again until it gets through. Every run writes the time to `heartbeat` in the state folder, and `--status` says `STALE` and exits 1 when there has been no run for five minutes, so something outside the machine can run it, or read that file, and tell someone when the watcher itself has stopped.

```bash
deploy/watch.sh --install     # on this Mac: a LaunchAgent of this user, every 60 s, desktop notifications
deploy/watch.sh --status      # the last state, the last lines of its log and when it last ran (exit 1 if not for 5 min)
deploy/watch.sh --uninstall   # remove it
```

On a Linux server, run `deploy/watch.sh --once` every minute from cron or a systemd timer, as a user that
may run `docker`. With no settings it watches the copy whose folder it sits in (on the VM, `hcml-portal-ollama`:
its port 8082 and its two containers), and the copy beside it when there is one, so a VM is not told that the
other copy is missing. Set `WATCH_URLS` to the address people use, such as `https://portal.hcml.co.id`, to test
the front door (it replaces the default loopback addresses, so list those too, space separated, to keep testing them), and `WATCH_NOTIFY_CMD` to a command line that mails or posts the message, which it gets as its last argument (quotes and arguments work, but a command that reads the message from its standard input, as `mail` does, needs a small wrapper: `WATCH_NOTIFY_CMD="sh -c 'printf %s \"\$0\" | mail -s \"HCML portal\" ops@example.org'"`). Without it a
server only writes the log, which `--status` shows. A cron line:

```
* * * * * WATCH_URLS=https://portal.hcml.co.id WATCH_NOTIFY_CMD=/usr/local/bin/portal-alert /opt/hcml-portal-ollama/deploy/watch.sh --once
```

HCML's own Zabbix can also watch the portal with a web scenario on `/bff/api/health`.

## Looking after it

```bash
docker ps --format '{{.Names}}  {{.Status}}'      # four containers, every one healthy
curl -s http://127.0.0.1:8081/bff/api/health       # {"ok":true,...}; :8082 for hcml-portal-ollama
```

To check Zabbix itself from this Mac, ask it for its version at the LAN address that
`docker-compose.override.yml` names, keeping the name so that the certificate is checked:

```bash
curl -s --resolve zabbix.hcml.co.id:443:<LAN address> https://zabbix.hcml.co.id/zabbix/api_jsonrpc.php \
  -H 'Content-Type: application/json-rpc' -d '{"jsonrpc":"2.0","method":"apiinfo.version","params":{},"id":1}'
```

It answers with the version, 7.0.x. If it answers and a portal's Dashboard still says that Zabbix cannot be
read, wait a minute and reload: the page `/api/ready` of a signed-in session says whether the BFF can read
Zabbix now.

## The local copy of Zabbix, retired

Until 29 October 2026 the portals read a copy of HCML's Zabbix database restored on this Mac: frozen at
first, and from 26 October polling HCML's devices from this laptop (option C). On 29 October its three
containers were removed with `docker compose down`. Its database volume `proto1_mysqldata`, the snapshot
in `myown/backups/zabbix-db-snapshot-2026-10-26/` and its Docker images were deleted the same day at the
owner's word, so it cannot be started again. The September dump it was restored from
(`myown/zabbix_backup.sql`) is kept until HCML says what it wants done with it.
How the copy ran and was tuned is in setup sections 26, 30 and 39 and in the CHANGELOG.
