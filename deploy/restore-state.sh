#!/usr/bin/env bash
# Put a copy made by deploy/backup-state.sh back into this copy's volumes: the users, the recipients, the schedule, the closed months and the log.
#
#   deploy/restore-state.sh FILE              open the copy and list what it holds; changes nothing
#   deploy/restore-state.sh FILE --apply      write it into the volumes of this copy, which must not be running
#
# The portal's containers have to exist and to be stopped, so that nothing writes while the files come back: `docker compose up --no-start` makes them on a new machine, and `docker compose stop`
# stops them on one that runs. A file in the copy replaces the file of the same name in the volume, and a file only the volume has is left. Each file of the state volume that is replaced is first
# copied beside itself as <name>.before-restore (the one before an earlier restore is overwritten), so that a restore of the wrong copy can be undone by hand. The passphrase is typed once, or read from
# the file named by BACKUP_PASSPHRASE_FILE. Afterwards start the stack (`docker compose up -d`, from the folder of the copy) and sign in as a restored user.
set -euo pipefail
umask 077

ROOT=$(cd "$(dirname "$0")/.." && pwd)
COPY=$(basename "$ROOT")
PASS=()
if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then PASS=(-pass "file:$BACKUP_PASSPHRASE_FILE"); fi

say() { printf '%s\n' "$*"; }
fail() {
  printf 'restore-state.sh: %s\n' "$*" >&2
  exit 1
}
# A typed passphrase is read once and held in this shell; openssl gets it through the environment of its own process, never a file and never an argument.
PASSPHRASE=""
read_passphrase() {
  [ -z "${BACKUP_PASSPHRASE_FILE:-}" ] || return 0
  local typed
  printf 'Passphrase: ' >&2
  IFS= read -r -s typed || fail "no passphrase was given"
  printf '\n' >&2
  [ -n "$typed" ] || fail "the passphrase is empty"
  PASSPHRASE=$typed
}
decrypt() {
  if [ -n "$PASSPHRASE" ]; then HCML_BACKUP_PASSPHRASE=$PASSPHRASE openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:HCML_BACKUP_PASSPHRASE; else openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 ${PASS[@]+"${PASS[@]}"}; fi
}

FILE=""
APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    -h | --help)
      sed -n '2,/^set -euo pipefail/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*) fail "unknown option $1" ;;
    *) [ -z "$FILE" ] || fail "one file at a time"; FILE="$1" ;;
  esac
  shift
done
[ -n "$FILE" ] || fail "name the copy to restore (deploy/restore-state.sh FILE)"
[ -f "$FILE" ] || fail "$FILE is not a file"
command -v openssl >/dev/null 2>&1 || fail "openssl is not here"
read_passphrase

decrypt <"$FILE" | gzip -t || fail "$FILE did not open: a wrong passphrase, or a damaged file"
if [ "$APPLY" = 0 ]; then
  say "$FILE opens, and the archive is whole. It holds:"
  decrypt <"$FILE" | tar -tz | sed 's/^/  /'
  say "Nothing was changed. Add --apply to write it into the volumes of $COPY."
  exit 0
fi

command -v docker >/dev/null 2>&1 || fail "docker is not here"
# From the copy's own folder: a COMPOSE_FILE line in its .env names files relative to where the command runs (IN-100).
# What Compose says is kept: a COMPOSE_FILE line that names a file that is not there makes it refuse, and "make the container" would send the operator to a command that fails the same way.
ps_out=$(cd "$ROOT" && docker compose --project-directory "$ROOT" ps -a -q portal-bff 2>&1 || true)
cid=$(printf '%s\n' "$ps_out" | grep -E '^[0-9a-f]{12,64}$' | head -n 1 || true)
if [ -z "$cid" ]; then
  said=$(printf '%s\n' "$ps_out" | head -n 3 | tr '\n' ' ')
  [ -z "${said// /}" ] || fail "docker compose in $COPY said: ${said}"
  fail "$COPY has no portal-bff container: make it first with docker compose up --no-start"
fi
[ "$(docker inspect -f '{{.State.Running}}' "$cid")" = "false" ] || fail "the portal of $COPY is running: stop it first (docker compose stop), so that nothing writes while the files come back"
state=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$cid")
logs=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/log/portal"}}{{.Name}}{{end}}{{end}}' "$cid")
image=$(docker inspect -f '{{.Config.Image}}' "$cid")
[ -n "$state" ] && [ -n "$logs" ] || fail "the portal-bff container of $COPY does not mount the volumes /data and /var/log/portal"

# What a restore replaces is kept first, beside itself: the files of the top of the state volume (users.json, portal-state.json and the others), one copy each.
# A copy that cannot be made stops the restore: it says the old files are beside the new ones, and they must be.
docker run --rm --network none --entrypoint sh -v "$state:/state" "$image" -c 'for f in /state/*; do case "$f" in *.before-restore) continue ;; esac; [ -f "$f" ] || continue; cp -p "$f" "$f.before-restore" || exit 1; done'
decrypt <"$FILE" | docker run --rm -i --network none --entrypoint tar -v "$state:/state" -v "$logs:/logs" "$image" -xz -C /
say "Restored $FILE into $state and $logs. What it replaced in the state volume is beside it as <name>.before-restore. Start the stack (docker compose up -d, from the folder of the copy) and sign in as a restored user."
