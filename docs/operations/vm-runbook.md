# Setting up the virtual machine for the portal and its local model

**Status: a skeleton. Nothing in it has been run on a virtual machine yet.** We keep it here so that the order, the checks and the questions are written before the machine arrives, and so that each step is filled in with what really happened when we run it. A step that has not been run says so.

What has been tried is only what can be tried without the machine. `deploy/gpu-gate.sh` ran against made-up machines (stand-ins for the commands it reads), `deploy/model-speed.py` ran against the Ollama of a Mac and against a made-up one, and Compose merged the three compose files for the model without starting anything. None of it has met a real server, a real card or HCML's network. On 18 November 2026 the two images were also built for x86-64 and run as a stack on the Mac under emulation, behind a TLS proxy with a throwaway certificate, and the volumes were backed up, wiped and restored; steps 5, 6, 7 and 10 say what was seen. That is a stand-in too: it had no Zabbix, no model, no card and none of HCML's network.

The machine runs one stack: the local-model copy of the portal (`hcml-portal-ollama`), the Ollama service that holds the model, and a TLS proxy in front. The hosted copy is not run there. The questions we asked HCML IT about the machine are in `myown/documents/notes/hcml-it-vm-and-sign-in-questions-2026-11-17.md` of our working folder, and the answers set the figures below.

Before you start, have: an account with `sudo`, a login with a key, the machine's address and the name people will use for the portal, the certificate for that name, the way the machine reaches Zabbix, and, for the model, whether a GPU was given to it.

## 0. Facts to read off the machine first

Not run. One script reads them all and prints a line for each, with OK, WARN, FAIL or NOTE, and a verdict at the end. It changes nothing and sends one request, to the model registry, to learn whether the registry answers:

```
bash deploy/gpu-gate.sh
```

It reads the system, the processor (cores and AVX2), the memory (we advise 32 GB, and it fails under 16 GB), the free disk under Docker's folder (we advise 100 GB, and it fails under 60 GB), Docker and its compose plugin, the NVIDIA card with its memory and driver, whether Docker has the NVIDIA runtime, and whether `registry.ollama.ai` gives a model's manifest. The limits are our own estimates, from the size of the model files plus the cache of an 8,192-token context, and are marked as such in the script. By hand, the same facts are `uname -m` (an image built on a Mac, which is arm64, does not run on x86_64), `lscpu | grep -o avx2`, `nvidia-smi`, `free -h`, `df -h /` and `timedatectl`.

If it says PROCESSOR ONLY, there is no card, and the gate in [the local model](#9-the-local-model-and-its-gate) decides whether the Assistant is switched on at all.

## 1. The operating system and access

Not run. Install the guest tools of the hypervisor, set up time synchronisation with `chrony` against the source HCML named, allow SSH by key only, switch on security updates, and hold back kernel and GPU-driver updates so that they are applied by hand after a test (a kernel update can leave the GPU driver out of step, and the model then starts on the processor).

Check: `chronyc tracking` shows an offset of a few milliseconds, and `ssh -o PasswordAuthentication=no` from another machine works while a password login does not.

## 2. The firewall

Not run. Port 22 from the addresses of the people who administer the machine, port 443 from the people who use the portal, and nothing else. A rule of the machine's own firewall (ufw, firewalld) does not limit a port that a container publishes: Docker's rules for it are checked first, so a proxy in a container that publishes 443 answers everyone who can reach the machine, whatever ufw says. Make the restriction to the people who use the portal in HCML's network firewall, or in Docker's `DOCKER-USER` chain, or run the proxy on the host itself ([tls.md](tls.md), Who can reach the proxy). The portal's ports 4000 and 8080 are reached inside Docker's own network. Ollama's port 11434 is published on the machine's loopback (`127.0.0.1`) so that the speed test, run on the machine, reaches it, and on no other address: nothing off the machine can reach it.

Check: from another machine, `nc -vz <machine> 443` connects, and the same for 4000, 8080 and 11434 does not. On the machine, `curl -s http://127.0.0.1:11434/api/tags` answers.

## 3. Docker

Not run. Docker Engine from Docker's own repository, started at boot. Give Docker's address pools an explicit range that does not overlap HCML's (`default-address-pools` in `/etc/docker/daemon.json`): a default pool that overlaps a network HCML uses makes Zabbix unreachable in a way that is hard to see. Set the daemon's default log limit in the same file (`"log-driver": "json-file", "log-opts": {"max-size": "50m", "max-file": "5"}`): the portal's file and the model's overlay set their own, and a container written by hand, such as the TLS proxy of [tls.md](tls.md) if it is not given one, would keep its log without a limit and fill the disk ([full-disk.md](full-disk.md)).

Check: `docker run --rm hello-world`, and `docker network inspect bridge` shows the range chosen. `docker inspect -f '{{json .HostConfig.LogConfig}}'` of a container made without log settings shows `max-size`.

## 4. The GPU, if there is one

Not run. The NVIDIA driver for the card, then the NVIDIA container toolkit, then Docker told to use it.

Check: `docker run --rm --gpus all <a CUDA base image of the driver's version> nvidia-smi` shows the card from inside a container.

## 5. The stack

Not run on a machine; run on a stand-in (the end of this step). Copy the folder of the local-model copy to the machine, make its `.env` on the machine by hand (we type the secrets and no one else reads them), and name the files the stack is made of in that `.env`, once, so that Ollama runs as a service of the stack and every later command uses the same files:

```
COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml:docker-compose.vm.yml                              # no card: the model runs on the processor
COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml:docker-compose.vm.yml:docker-compose.vm-gpu.yml   # with a card and the NVIDIA runtime
```

Then, from the folder of the copy, `docker compose up -d` starts it. `deploy/gpu-gate.sh` prints the line that fits the machine. The three files are the portal's own, the one that says how Zabbix is reached from HCML's network (`docker-compose.override.yml`: a command with `-f` does not read it, and neither the portal nor Ollama then finds its way), and the overlay of this machine. `docker-compose.override.yml` is not in git and no step makes it: it holds the address by which HCML's Zabbix is reached, so it is made by hand, on the machine, where Zabbix needs it. Where the containers reach Zabbix by a name that resolves from inside them, there is no such file and the line leaves it out: a line that names a file that is not there stops every Compose command. `deploy/gpu-gate.sh` prints the line with the file named only where it is in the folder, and says so when it is not. With the line in `.env`, `docker compose ps`, `deploy/rebuild.sh`, `deploy/backup-state.sh`, `deploy/restore-state.sh` and the steps of the handbook for changing a setting or going back all name the same files: without it a rebuild brings the portal up with the base file alone, points it at the wrong model address and leaves Ollama running as an orphan. The names in the line are read from the folder the command runs in, so run the commands from the folder of the copy (the scripts change into it themselves).

The overlay adds the `ollama` service to the portal's own network, publishes its port on the machine's own loopback and nowhere else, and points the portal at `http://ollama:11434/v1`. That address is written in the overlay and is not a setting: a line `AI_BASE_URL=` in `.env` does not change it (the example `.env` of the local-model copy has that line commented out for the Mac, where Ollama runs on the Mac itself). The containers restart on their own at boot (`restart: unless-stopped`). The Ollama image is pinned to a version (`ollama/ollama:0.33.3`, the one our tests ran against), and that tag has not been pulled yet: when the machine first pulls it, write down the digest it resolves to (`docker image inspect --format '{{index .RepoDigests 0}}' ollama/ollama:0.33.3`) beside the date, so that the next pull can be compared with it.

Three settings of the overlay are named in `deploy/settings.example` (commented out, since the portal's own file does not pass them): `OLLAMA_IMAGE` (the tag, which a machine may change), `OLLAMA_NUM_PARALLEL` (questions answered at once, 1) and `OLLAMA_MEM_LIMIT` (the memory the container may take, 16 GB by default, which is also the least the gate asks of the whole machine: set it with the machine's memory in view). A newer release of the Ollama image is looked at by hand, since the monthly round in the handbook names the Ollama image beside the base images; Dependabot reads the compose files too, but the tag is a setting there (`OLLAMA_IMAGE`), so a pull request may not reach the line.

After the first start has worked, and not before, the Ollama container is hardened as the portal's own are, one change at a time with the card handed through: `cap_drop: [ALL]`, a read-only root with the model volume and a `tmpfs` for `/tmp` writable, and the image named by its digest (`image: ollama/ollama@sha256:...`, the digest written down as above). The overlay is not hardened yet because a first start that fails for a reason of ours is worse than a container that is a little less shut; this pass is the step that follows it, and it has not been done.

The model is not in the image. Pull it into the volume once, and set `AI_MODEL` to its name in `.env`:

```
docker compose exec ollama ollama pull <model>
docker compose exec ollama ollama show <model>     # write down the digest and the licence line beside the date
```

What the three candidate models' own files say, read with `ollama show` on 18 November 2026: `qwen3:8b` has no minimum, `qwen3.5:9b` requires Ollama 0.30.0 or later and `gemma4:12b` requires 0.30.9 or later, so the pinned `0.33.3` serves all three and an older tag would not serve `gemma4:12b`. Each file carries the Apache License 2.0 as its licence text, with no separate model licence. Their sizes on disk are 5.2 GB, 6.6 GB and 8.0 GB. A fourth model that was tried, `sailor2:8b` (5.2 GB, 32,768 tokens of context), names no minimum either, and its file carries no licence text (the Ollama library page says Apache 2.0); it did not pass the test and is not a candidate.

If the machine cannot reach the registry, the model is brought in by hand: pull it on another machine, copy that machine's `~/.ollama/models` into the volume `ollama-models` (`/root/.ollama/models` inside the container), and check with `ollama list`. This path has not been tried.

How a new version reaches the machine is still to settle: either `deploy/rebuild.sh` runs there (it builds the copy it sits in and, when it sits in the hosted copy, the local-model copy beside it if that folder is there, so on a machine with only the local-model copy it builds that one), or the images are built elsewhere for the machine's architecture and loaded with `docker load`.

Check: `docker compose ps` shows every service healthy, `docker compose config | grep AI_BASE_URL` says `http://ollama:11434/v1`, and `curl -s http://127.0.0.1:8082/bff/api/health` answers on the machine (the web container passes `/bff` to the server, which publishes no port of its own).

Run on a stand-in, 18 November 2026. Both images were built for `linux/amd64` from the working tree with `docker buildx build --platform linux/amd64 --load` on the Mac (about 15 minutes, nearly all of it the first pull of the base image over a slow line and `npm ci` under emulation). In the BFF image: Node 24.22.2 on linux/x64, `crypto.argon2` present, an Argon2id hash and a scrypt hash made and checked through the shipped code (40 ms for an Argon2id hash under emulation), the image's user `node` (uid 1000), and a busybox `tar`. The stack was started from `docker-compose.yml` and a stand-in file that points it at those images, with a made-up `.env`, no Zabbix and no Ollama: both containers were healthy within 15 seconds, with a read-only root, the unprivileged users, and `restart: unless-stopped`. The overlays `docker-compose.vm.yml` and `docker-compose.vm-gpu.yml` merged with Compose (`config --quiet`), but the Ollama image was not pulled and Ollama was not started. The portal answered `"ready":false` and logged that it had no Zabbix token and could not reach Zabbix, which is what that stack should say.

How a new version can reach the machine without the source or the registry: build the images for x86-64 elsewhere, `docker save` the two into one file (96 MB gzipped), copy it over, and `gunzip -c file | docker load` there. The loaded image passed the same checks. What is not settled is the script: `deploy/rebuild.sh` builds for the architecture of the machine it runs on and was not run for another one.

## 6. The TLS proxy

Not run on a machine; run on a stand-in (the end of this step). nginx, Caddy or Traefik as [tls.md](tls.md) shows. It must keep the browser's `Host` header as it arrived, and the portal is told how many proxies stand in front of it (`TRUST_PROXY=2` in this setup), because the portal compares the `Origin` of a request with its `Host`.

Check: the page loads at `https://<portal name>/`, the certificate is the one HCML gave and not near its end, and signing in sets a cookie marked `Secure`.

Run on a stand-in, 18 November 2026: nginx in a container on the compose network as in [tls.md](tls.md), a throwaway certificate for a made-up name (`portal.rehearsal.test`, reached with curl's `--resolve`), `WEB_ORIGIN=https://portal.rehearsal.test:18443` and `TRUST_PROXY=2`. Seen: the page loads and `/bff/api/health` answers through the proxy with the certificate checked; one `Strict-Transport-Security: max-age=300` header, not two; a sign-in sets `HttpOnly; Secure; SameSite=Strict`; a sign-in whose `Origin` names another site is refused with 403 `csrf`; and a sign-in sent straight to the web container's port over plain HTTP, without the proxy's `X-Forwarded-Proto`, sets the cookie without `Secure`, which is what tls.md says the header is for. One trap came up: the proxy container stopped with `host not found in upstream "portal-web"` when the whole stack was restarted together, because nginx looks the name up once at start. With `restart: unless-stopped` on the proxy it came back by itself and answered five seconds after the restart (tls.md says so too). Not seen: a certificate from HCML, the portal's real name, and the event streams (the live Dashboard and the Assistant) through the proxy, since there was no Zabbix to stream from.

## 7. Backup

Not run on a machine; written as two scripts and run on a stand-in (the end of this step). An encrypted copy, off the machine, of the state volume (the users, the recipients, the schedule and the web check figures of closed months) and of the logs, as [backup-and-restore.md](backup-and-restore.md) describes. `users.json` holds password hashes, so the copy is treated as a secret. `deploy/backup-state.sh` makes it (with `--env`, also the settings files) and `deploy/restore-state.sh FILE --apply` puts it back. The passphrase is typed once, and once more when a copy is made so that a slip is caught, or read from a file (`BACKUP_PASSPHRASE_FILE`); `BACKUP_KEEP` must be a whole number of 1 or more, and the oldest copies by the stamp in their names are the ones deleted. A restore keeps each file it replaces beside it as `<name>.before-restore`. Make the folder the copies go to before the first run, readable by the group of the Zabbix agent (`install -d -m 750 -g zabbix /var/backups/hcml`): the script makes a folder it does not find with mode 700 for its own user, and the agent of step 8, which runs as another, then cannot read the age of the newest copy (the probe says so, and the item stays not supported). The files stay mode 600.

Check: a restore onto a throwaway machine brings back the users, the recipients, the schedule and the closed months, and a person can sign in with the restored account.

Written as two scripts, `deploy/backup-state.sh` and `deploy/restore-state.sh`, and run on the stand-in of step 5 on 18 November 2026. The backup of the running stack's volumes made one encrypted file of 2.3 KB (it begins `Salted__`, holds no plain text, and `--check` listed `state/users.json`, `state/portal-state.json` and `logs/bff.log`), `--env` made a second one of the made-up `.env`, and the checksum file verified. A restore was refused while the portal ran, and a wrong passphrase was refused. Then the stack was removed with its volumes (`docker compose down -v`) and its containers made again without starting them (`docker compose up --no-start`), which is a new machine: the new volume was empty, the restore put `users.json`, `users.json.prev`, `portal-state.json` and `bff.log` back with the owner `node` and mode 0600, the stack started, and the user who had been added and had changed their password signed in with the new password and not the old one, and the administrator of `.env` signed in too. The hash in `users.json` was Argon2id. What was not tried: the recipients, the schedule and the closed months (the stand-in had none), a copy taken off the machine, and a daily run. For the daily run, a line such as `15 2 * * * BACKUP_DIR=/var/backups/hcml BACKUP_PASSPHRASE_FILE=/root/.hcml-backup-pass /opt/hcml-portal-ollama/deploy/backup-state.sh` in root's crontab is the way we would do it, and it has not been run.

## 8. Monitoring of the machine

Written, and tried on stand-ins; not run on a machine. HCML's Zabbix watches it: an agent on the machine, a web check on `/api/health`, the GPU's temperature and memory, the disk, and the days left on the certificate. Three files in `deploy/` do the part that is the portal's own:

* `deploy/portal-probe.sh` gives one value a call: `health` (1 when the portal answers 200 and says `"ok":true`), `zabbix` (1 when the portal says that its own Zabbix answers), `cert-days HOST [PORT]` (whole days until the certificate that the name shows ends, negative once it has), `ollama` (1 when the model server answers its list of models on the machine's loopback), `backup-age [DIR]` (whole hours since the newest backup file in DIR), `gpu-temp` and `gpu-mem-pct`. A value it cannot read is printed as `ZBX_NOTSUPPORTED`, which Zabbix shows as an item that is not supported, so a machine with no card has two such items and no more. It reads and changes nothing. Every call stops itself after two seconds, below the three that a Zabbix agent waits unless its `Timeout=` (1 to 30, in the agent's file) says more: a portal that accepts the connection and never answers then reads 0 and raises the problem, and does not leave the item unsupported with no problem at all. Keep the agent's `Timeout=` at 3 or more. `PORTAL_URL` is where the portal answers from the machine (default `http://127.0.0.1:8082`, the web container's published port in this stack; the keys file sets it for the two keys that need it).
* `deploy/zabbix/hcml-portal.conf` is the agent's file of keys (`hcml.portal.health`, `hcml.portal.zabbix`, `hcml.portal.cert.days[host,port]`, `hcml.portal.ollama`, `hcml.portal.backup.age[folder]`, `hcml.portal.gpu.temp`, `hcml.portal.gpu.mem.pct`). Copy it into the agent's include folder (`/etc/zabbix/zabbix_agentd.d/`, or `zabbix_agent2.d/`), change the path in it to where the folder of the portal is and the port to the web container's, and restart the agent. The agent runs the script as its own user, which needs `curl` and `openssl`, and `nvidia-smi` on a machine with a card.
* `deploy/zabbix/template-hcml-portal.yaml` is a template for Zabbix 7.0 with an item for each key and these triggers: the portal does not answer for three checks in a row (High), the portal cannot read Zabbix (Average), the certificate ends within 30 days (Warning) and within 7 (High), the model server does not answer for five checks (Average), the newest backup is older than 36 hours (Warning), and the card above 85 degrees for ten minutes or above 95 percent of its memory for thirty (Warning). An item that stops reporting never reads 0, so the health, the certificate, the model server and the backup each also have a `nodata()` trigger: the health item with no value for five minutes (High), the others for ten minutes or three hours (Warning). The names of the portal and the limits are macros of the template (`{$PORTAL.HOST}`, `{$PORTAL.PORT}`, `{$PORTAL.CERT.WARN}`, `{$PORTAL.CERT.CRIT}`, `{$PORTAL.GPU.TEMP.WARN}`, `{$PORTAL.GPU.MEM.WARN}`, `{$PORTAL.BACKUP.DIR}`, `{$PORTAL.BACKUP.MAX.HOURS}`), to set on the host that it is linked to.

The two GPU items have no no-data trigger, on purpose: a machine with no card would raise it for ever. On a machine with a card, add one by hand if a card that goes silent should be heard. The disk and the memory of the machine are not here: they come from Zabbix's own Linux template, which HCML probably links to every server already. The web check from outside, through the proxy, is a web scenario of HCML's own on `https://<portal name>/bff/api/health`; the probe's `health` is the view from inside the machine.

What has been tried: the probe against made-up portals (healthy, not ready, 503, nothing listening, and a curl and an openssl that never answer), a real throwaway certificate (39 days left on a certificate made for 40), made-up backup files of known ages and made-up `nvidia-smi` output (`portal-probe.test.ts`). The template was parsed as YAML: it is valid, every id is unique and 32 hex digits, each trigger names an item that the template defines, each macro that is used is set, every item that can stop reporting has a `nodata()` trigger, and the keys of the agent file are the keys of the items. **It has not been imported into any Zabbix.** Import it on a test host first (Data collection, Templates, Import), link it, copy the keys file to that host's agent, and write down what Zabbix says: a trigger expression that Zabbix 7.0 rejects shows at import.

Check: the items of a linked host have values within two minutes (the backup item within an hour, and not supported until a first backup is made), and stopping the portal's web container raises "HCML portal does not answer" within four.

## 9. The local model and its gate

Not run. With a card, the stack of step 5 with the card's overlay is enough. Without one, the Assistant is not switched on until the speed test below says PASS on the processor: the real question, a prompt of about 2,900 tokens, must give its first word within 30 seconds of a cold start (our threshold, set because the user waits for it before the first word; the portal gives up at 120 seconds). If it fails, the choices are the Assistant off, a hosted model after HCML's written approval, or a card.

Check: the speed test below.

### Model speed test

Not run. On the machine, after the model is pulled:

```
python3 deploy/model-speed.py <model>              # --limit 30 is the limit on the first word; --base names another Ollama
```

It needs only Python 3, and it asks `http://127.0.0.1:11434`, which is the port that `docker-compose.vm.yml` publishes on the machine's loopback, so on the machine it needs no `--base` (Ollama's image has no Python, so the script runs on the machine and not in the container). It unloads the model so that the first read is cold, then asks the real question and prints the time to the first word (loading, then reading the prompt, with the tokens a second of the read), the time for the whole answer, a second question whose prompt is read already, the speed of the answer in tokens a second, four questions at once, and where Ollama says the model sits (`100% GPU`, or the share that spilled onto the processor). It ends with PASS or FAIL against the limit and exits 0, 1 or 2 (2 when it could not run). The prompts are the ones the portal builds for the made-up estate of `server/scripts/bakeoff` (`prompt-sample.json`), so nothing of HCML's is sent.

What the script cannot do in one run is the card's memory after a day of use: it prints the memory before and after the run, and we read `nvidia-smi` again after a day. A model that fits the card when idle but spills onto the processor with four people asking is a result too, and `sits on` shows it. The numbers go into the hardware table of the handbook, and they decide which model stays.

## 10. Acceptance

Not run on a machine; some items were tried on a stand-in (below the list). Each of these must pass before people use the machine:

* The SLA of the same closed month, read from the Mac and from the machine, matches to the last digit (compare the JSON without `generatedAt` and `stats`).
* After a reboot with no one signed in, `/api/health` answers.
* With Ollama up, the portal reaches it: `python3 tools/live/signedin_check.py <the portal's address> --expect-ai local` (sign in with an administrator) says that the model is local and answers. A portal pointed at an address where nothing listens passes every other check and never answers a question, so this one is not optional.
* With Ollama stopped (`docker compose stop ollama`), every page works and the Assistant says that it is unavailable. That is also how the Assistant is switched off on this machine: stop the service, and start it again with `docker compose start ollama`. There is no setting for it, and the stop does not last: a later `docker compose up -d`, a run of `deploy/rebuild.sh` or the end of a restore starts the stopped service again, so stop it once more after any of them.
* A restore from backup, on a throwaway, brings back the users and the rest.
* The certificate is valid and `chronyc tracking` shows a small offset.
* An hour with fifteen people signed in, then a day with the GPU memory steady.

On the stand-in of 18 November 2026, which has no Zabbix, no model and no card: the restore item was passed (step 7). After every container was restarted at once, with nobody signed in, `/api/health` answered within a few seconds once the proxy had a restart policy; that is a restart and not a reboot, and a reboot of a machine was not tried. The days left on a certificate were read by `deploy/portal-probe.sh` (29 on a certificate made for 30). Not tried: the SLA of a closed month from two places, the Assistant with Ollama stopped (the chat answered "The data source is not answering." because the snapshot is built from Zabbix before the model is asked, so the stand-in cannot show the model's absence alone), `chronyc tracking`, and the hour with fifteen people and the day of the card's memory.

## 11. Switching over, and going back

Not run. We type the secrets into `.env` on the machine. The portal's name is pointed at the machine and the portals on the Mac are stopped. The way back stays ready until the machine has run for a week: the old record of the name, the Mac's images, and the rollback tags that `deploy/rebuild.sh` makes.

## Related

* [tls.md](tls.md), [after-a-restart.md](after-a-restart.md), [backup-and-restore.md](backup-and-restore.md), [full-disk.md](full-disk.md)
