# When the disk is full

What fills the disk of the machine that runs the portals, how to see which it is, and what is safe to remove and what is not (tracker IN-77).
It is written from the files of this repository and from one Mac: nothing here was tried on HCML's server.

## What the portals write

| What | Where | How big it gets |
|---|---|---|
| Container logs | Docker's `json-file` driver, set once in `docker-compose.yml` (`x-logging`) | Up to five files of 50 MB for each container, so up to 250 MB for each of the four containers (two copies, two containers each). On the VM the model's container has the same limit, set in its overlay, and a proxy container that is written by hand has none unless it is given one ([tls.md](tls.md)); the daemon's default in step 3 of [the runbook](vm-runbook.md) covers any other. They are deleted when a container is made again |
| The server's own log | The `portal-logs` volume of each copy (`/var/log/portal`), written by the server itself | At most `LOG_FILE_KEEP` files of `LOG_FILE_MAX_MB` MB, ten of 20 MB by default, so 200 MB for each copy. A rebuild keeps it; `docker compose down -v` deletes it |
| Saved logs | `~/.local/state/hcml-portal-logs`, written by `deploy/rebuild.sh` before each rebuild | One compressed file for each copy and each rebuild, the newest 30 of each kept (`LOG_ARCHIVE_KEEP`). 6.2 MB on the Mac on 12 November 2026 |
| The watcher | `~/.local/state/hcml-portal-watch` (`deploy/watch.sh`) | A state file and a log that grows by a line for each thing it says |
| Images | Docker | Each rebuild keeps the images it replaced under a `rollback-<day><month>` tag, and `last-good` keeps one more. Docker on the Mac held 30 images of all projects, 18.4 GB, 9.4 GB of it reclaimable, on 12 November |
| Build cache | Docker | 9.3 GB on the same Mac, 7.6 GB of it reclaimable (with `--all`, below) |
| The state volume | `portal-state` | Kilobytes: the saved list, the schedule and the last 24 sends, the web check figures of closed months, the users file (about a kilobyte for each user) and the requests for an account (50 waiting at most, unless `ACCOUNT_REQUESTS_MAX_PENDING` says otherwise) |
| The models | `ollama-models`, on the VM only | Several gigabytes for each model that was pulled. `docker compose down -v` deletes it, and the models are pulled again at the cost of the download |

## See which it is

```bash
df -h                                  # the disk itself
docker system df                       # images, containers, volumes and the build cache
du -sh ~/.local/state/hcml-portal-logs # the saved logs
```

## What is safe to remove, in this order

1. The build cache: `docker builder prune` removes the cache nothing refers to, and `docker builder prune --all` all of it. The next build is slower, nothing else changes. It was done on the Mac on 19 November 2026 (11.9 GB).
2. Images with no tag and no container: `docker image prune`.
3. Rollback tags older than the newest few, and only with the word of whoever owns the portal, who names the number (setup 23, *Rolling back*, and [`deploy-rebuild-rollback.md`](../handover/4-working/deploy-rebuild-rollback.md)): `deploy/rebuild.sh --prune-rollbacks=N` keeps the newest N of each image (the ones made last, whatever order Docker lists them in) and untags the older ones, builds nothing, never touches `:latest` or `last-good`, and keeps any tag that names the image that runs or `last-good`; `--dry-run` shows what it would remove. By hand it is `docker image rm <image>:rollback-<day><month>` for each of the four images.
4. The oldest saved logs in `~/.local/state/hcml-portal-logs`, or a lower `LOG_ARCHIVE_KEEP` before the next rebuild.

## What not to do

- Remove a volume that is not the portal's because Docker calls it dangling. A dangling volume is one that no container refers to, and that says nothing of whose data it holds: on the Mac on 19 November 2026 the dangling ones were eight anonymous volumes from May and the data volumes of two other projects (a Postgres and a ClickHouse among them), none of them the portal's. `docker volume ls --filter dangling=true` lists them; look at the names and the dates, and remove only what you know to be yours.
- `docker compose down -v`, or `docker volume prune --all` and `docker system prune --all --volumes` once the containers are gone (after `docker compose down`). They delete `portal-state`, and with it every account made on the Users page, the requests for an account, the saved list and the monthly schedule, and `portal-logs`, the server's own copy of its log; on the VM they delete `ollama-models` too, which is several gigabytes to pull again. Take a copy first with `deploy/backup-state.sh` ([backup-and-restore.md](backup-and-restore.md)). Before Docker 23, plain `docker volume prune` and `docker system prune --volumes` deleted named volumes too, so on an older Engine take the same care with them.
- `docker system prune -a`. It deletes every image without a container, the rollback and `last-good` tags with them, and with those the way back from a bad build.

## What the portal does meanwhile

A portal that cannot write its state file cannot record a send. The monthly send is then not made, since a send it cannot record is not made, and the Schedule dialog says so; the log gets one error line, `report_state_unwritable`, when it starts, and the portal tries a write at each tick and goes on when there is room again ([setup 18](../setup/18-automated-reporting.md), when the data folder stops taking writes). A report sent by hand from the Email dialog still goes, and the log gets a warning, `send_not_recorded`, because its record could not be kept. After you free space, check `curl localhost:8081/bff/api/health` (8082 for `hcml-portal-ollama`) and look under Last sends in the Schedule dialog for the month that waited.
