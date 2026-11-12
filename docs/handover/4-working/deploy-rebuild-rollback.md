# Deploy, rebuild and roll back

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Operators and developers | about 7 min | [Run it](run-it.md) | [Change recipes](change-recipes.md) |

How a change reaches the running portals, how to go back, and how to change a setting without a rebuild. The reasons behind each step are in [Operations](../3-integrations/operations.md). This page is the order to do them in. Nothing is deployed from GitHub: a change goes live only when someone runs the rebuild script on the machine that runs the portals.

## Before a change goes live

1. Make the change in `hcml-portal`, the first copy. The other copy, `hcml-portal-ollama`, is brought equal by copying the shared files across, and the few files meant to differ are edited by hand in both. [The two copies](../1-folders/the-two-copies.md) says which files differ and how to bring the rest equal.
2. Run `npm run verify` at the root of each copy. It takes about five minutes, and it ends with `check:parity`, which fails if the copies drifted.
3. Commit in `hcml-portal`, and then in `hcml-portal-ollama`, each in its own repository. The first repository is public, so read what is staged before committing in either, and never stage `docker-compose.override.yml` or an `.env` file. A build made from uncommitted files is labelled `<commit>-dirty` and gets no release tag.

## Rebuild

Run the script from `hcml-portal`, and run it with `--dry-run` first: it prints every command that would change something and runs none.

1. `deploy/rebuild.sh --dry-run`. Read which commit names the build, which images are kept for a rollback, in which order the copies are built, and what makes the script refuse.
2. `deploy/rebuild.sh`. In a git checkout it refuses a tree whose `server/`, `web/` (less their tests) or compose file differs from the commit. `--allow-dirty` builds anyway and labels the build `<commit>-dirty`, with no tag. A folder with no git, such as a copy of `hcml-portal-ollama` made without its `.git` folder, is built too: the build is labelled `unknown` and gets no tag. `--skip-verify` leaves out `npm run verify`, and is for use only after a verify that has just passed. The names of the images and containers come from the `name:` line of each `docker-compose.yml` (`hcml-portal` and `hcml-portal-ollama`), so a clone in a folder with another name is built under the right names; the other copy is found beside it in a folder called `hcml-portal-ollama`.
3. The script checks that Docker can read each copy's `.env` before it tags anything. It then saves the logs of the running containers of each copy, compressed, in `~/.local/state/hcml-portal-logs` (`LOG_ARCHIVE_DIR`), the newest 30 of each copy by the time in the file's name (`LOG_ARCHIVE_KEEP`, at least 1), because a new container starts with an empty log and the old one goes with the container. The files are readable by you alone, since the log holds the names typed at sign-in, addresses and the text of searches; a folder that cannot be made does not stop the build. It tags the images it replaces `rollback-<day><month>`, builds both copies with `docker compose up -d --build`, and waits up to 180 seconds for the containers to be healthy.
4. It then asks as an anonymous caller. Health must answer 200, the meters 401, `/.env` and `/.git/config` 404, and the page must carry a content-security policy. It prints the bundle name and the build, and on a clean tree makes the local tag `live-<date>`. It never pushes the tag. A copy that fails these checks stops the run before the next copy is touched, so one portal still runs the build it had. The script does not mark `last-good`: a build that passed the checks it can make may still fail the one that needs a person.
5. The check that needs a person comes last. The script cannot sign in, so run `tools/live/signedin_check.py` against each portal, with your own name and password in your own shell (`PORTAL_USER` and `PORTAL_PASSWORD`; the account must be an administrator), with `--expect-mail on` for the hosted copy and `--expect-mail off` for the local-model copy, and open the Dashboard and Problems on each. The password is never printed or written down. When those pass, `deploy/rebuild.sh --mark-good` keeps the images that run now as `last-good`, the build a later failed run points back to; it builds nothing and asks no git.

A change to the documents only does not need a rebuild: documents are not part of the images.

## Roll back

If a rebuild fails or a build proves bad, the previous images are tagged `rollback-<day><month>`. When the script stops because the build or its checks failed, it lists `last-good` first, the build someone marked good with `--mark-good`, and then the tags it made, each image under its own name; the two images of one copy need not carry the same suffix. The tags of a run hold what ran before it, which is a failed build when the run before it failed too, so `last-good` is the one to use. A build that has not been marked is not `last-good`: when a build proves bad before anyone marked it, use the `rollback-<day><month>` tag of the run. To go back in one copy:

1. In that copy's folder, find the tag: `docker images` lists each image with its tags. The images are named for the folder and the service: `hcml-portal-portal-bff` and `hcml-portal-portal-web` for the hosted copy, and `hcml-portal-ollama-portal-bff` and `hcml-portal-ollama-portal-web` for the other. A rollback tag is the day and the month, such as `rollback-30oct`. A second rebuild on the same day takes `rollback-30oct-2`, a third `-3`, and so on, so a higher suffix is a later rebuild, holding the image that rebuild replaced.
2. Give the good image the name `latest`, for each of the two images: `docker tag <image>:last-good <image>:latest`, or, when the script names no `last-good`, `docker tag <image>:rollback-<day><month> <image>:latest`.
3. Start without building: `docker compose up -d --no-build`.
4. Check the health address, and open the Dashboard.

The rule keeps the two newest rollback tags of each image. Delete older ones only when the owner says so, because each is a way back. `last-good` is a name that moves to the build someone last marked with `--mark-good`; it holds no image of its own to keep or delete.

## Change a setting

Most behaviour is a setting. A setting is changed by editing `.env` in the copy's folder and recreating the server container with `docker compose up -d` in that folder. The server reads its settings once, when it starts, so nothing changes until then.

1. Edit `.env`, never the compose file, unless you are adding a new setting. [Change recipes](change-recipes.md) says how.
2. Save the log first, because a recreated container starts with an empty one and the log is the portal's only audit trail: `mkdir -p ~/.local/state/hcml-portal-logs && (umask 077; docker compose logs --no-color --timestamps portal-bff | gzip > ~/.local/state/hcml-portal-logs/hcml-portal-$(date -u +%Y%m%dT%H%M%SZ).log.gz)`. Then `docker compose up -d`. Compose recreates only what changed.
3. Make a new encrypted copy of the `.env` files, if the change was to a user, a role, a token, `JWT_SECRET` or a threshold. They hold the portal's secrets and settings, and git ignores them on purpose. [Backup and restore](../../operations/backup-and-restore.md) has the commands.
4. If the change was to a token, check that the health answer's `ready.zabbix` says `ok`.

## Reach the portal from another machine

The portal speaks plain HTTP on the host's own address, which is right for a laptop and wrong for anything else. Put a TLS proxy on the same machine in front of it, send `X-Forwarded-Proto: https`, keep the browser's `Host`, do not buffer, send HSTS, and set `WEB_ORIGIN` to the address people type and `TRUST_PROXY` to 2. [The TLS runbook](../../operations/tls.md) has recipes for nginx, Caddy and Traefik, and the check that it works.

## Stop one portal, or both

`docker compose stop` in a copy's folder stops its two containers, and ends the live streams within a few seconds. A container that someone stopped by hand stays stopped when Docker restarts, because of `restart: unless-stopped`. `docker compose up -d` starts it again. To undo the restart rule on one container, `docker update --restart no <name>`.
