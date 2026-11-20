#!/usr/bin/env bash
# An encrypted copy of what the portal keeps in its volumes, made without a plain file on the disk: the users and their password hashes, the saved recipients, the schedule, the closed months'
# web check figures (the volume `portal-state`) and the server's own copy of its log (`portal-logs`). The runbook's step 7 and docs/operations/backup-and-restore.md say why and what to do with it.
#
#   deploy/backup-state.sh                    make a copy of this copy's volumes, in $BACKUP_DIR (default ~/hcml-backup)
#   deploy/backup-state.sh --env              also make one of .env, server/.env and docker-compose.override.yml, which hold secrets
#   deploy/backup-state.sh --check FILE       open a copy and test it, and list what it holds; writes nothing
#
# Run it from a copy's folder or by its path: it works on the copy it sits in. The passphrase is typed once (and once more to be sure it was not slipped), or read from the file named by
# BACKUP_PASSPHRASE_FILE (readable by you alone, and kept off this machine's disk of backups). BACKUP_KEEP (default 14, a whole number of 1 or more) is how many copies of the volumes are kept; the older ones are deleted. The volumes are read through the portal's own image, which
# has `tar`, so nothing is pulled and nothing is installed. Copy the result off this machine, and keep the passphrase somewhere else: a backup on the same disk is lost with it.
set -euo pipefail
umask 077

ROOT=$(cd "$(dirname "$0")/.." && pwd)
COPY=$(basename "$ROOT")
DEST="${BACKUP_DIR:-$HOME/hcml-backup}"
KEEP="${BACKUP_KEEP:-14}"
PASS=()
if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then PASS=(-pass "file:$BACKUP_PASSPHRASE_FILE"); fi

say() { printf '%s\n' "$*"; }
# What was being written when something failed is not left behind: a partial file is not a copy, and the retention below would never count it.
PARTIAL=""
cleanup() { [ -z "$PARTIAL" ] || rm -f "$PARTIAL"; }
trap cleanup EXIT
fail() {
  printf 'backup-state.sh: %s\n' "$*" >&2
  exit 1
}
# A typed passphrase is read once and held in this shell: openssl gets it through the environment of its own process, never a file and never an argument, so each of the several calls below does not ask again.
PASSPHRASE=""
read_passphrase() { # "confirm" types it twice, as a copy is made
  [ -z "${BACKUP_PASSPHRASE_FILE:-}" ] || return 0
  local first second
  printf 'Passphrase: ' >&2
  IFS= read -r -s first || fail "no passphrase was given"
  printf '\n' >&2
  if [ "${1:-}" = confirm ]; then
    printf 'Passphrase again: ' >&2
    IFS= read -r -s second || fail "no passphrase was given"
    printf '\n' >&2
    [ "$first" = "$second" ] || fail "the two passphrases are not the same"
  fi
  [ -n "$first" ] || fail "the passphrase is empty"
  PASSPHRASE=$first
}
crypt() { # openssl enc, with its own flags first
  if [ -n "$PASSPHRASE" ]; then HCML_BACKUP_PASSPHRASE=$PASSPHRASE openssl enc "$@" -pass env:HCML_BACKUP_PASSPHRASE; else openssl enc "$@" ${PASS[@]+"${PASS[@]}"}; fi
}
encrypt() { crypt -aes-256-cbc -pbkdf2 -iter 600000 -salt; }
decrypt() { crypt -d -aes-256-cbc -pbkdf2 -iter 600000; }
# The checksum names the file without its folder, so that `sha256sum -c` works from wherever the folder of copies is put.
sha256_of() { (cd "$(dirname "$1")" && if command -v sha256sum >/dev/null 2>&1; then sha256sum "$(basename "$1")"; else shasum -a 256 "$(basename "$1")"; fi); }
size_of() { wc -c <"$1" | tr -d ' '; }

ENV=0
CHECK=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV=1 ;;
    --check)
      shift
      [ $# -gt 0 ] || fail "--check needs the file to open"
      CHECK="$1"
      ;;
    -h | --help)
      sed -n '2,/^set -euo pipefail/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) fail "unknown option $1" ;;
  esac
  shift
done

command -v openssl >/dev/null 2>&1 || fail "openssl is not here"

# A count of copies that is not a whole number of 1 or more would keep none (0 lists every copy as old) or stop with an arithmetic error after the copy was written.
case $KEEP in '' | *[!0-9]* | ???????*) fail "BACKUP_KEEP is the number of copies to keep, a whole number of 1 or more; it is \"$KEEP\"" ;; esac
KEEP=$((10#$KEEP))
[ "$KEEP" -ge 1 ] || fail "BACKUP_KEEP is the number of copies to keep, a whole number of 1 or more; it is 0"

# Open a copy and test it. gzip carries its own check, so a copy damaged anywhere reads as an error here, which the encryption alone would not say.
if [ -n "$CHECK" ]; then
  [ -f "$CHECK" ] || fail "$CHECK is not a file"
  read_passphrase
  decrypt <"$CHECK" | gzip -t || fail "$CHECK did not open: a wrong passphrase, or a damaged file"
  say "$CHECK opens, and the archive is whole. It holds:"
  decrypt <"$CHECK" | tar -tz | sed 's/^/  /'
  exit 0
fi

command -v docker >/dev/null 2>&1 || fail "docker is not here"
# From the copy's own folder: a COMPOSE_FILE line in its .env names files relative to where the command runs (IN-100).
# What Compose says is kept: a COMPOSE_FILE line that names a file that is not there makes it refuse, and "start the stack once" would send the operator to a command that fails the same way.
ps_out=$(cd "$ROOT" && docker compose --project-directory "$ROOT" ps -a -q portal-bff 2>&1 || true)
cid=$(printf '%s\n' "$ps_out" | grep -E '^[0-9a-f]{12,64}$' | head -n 1 || true)
if [ -z "$cid" ]; then
  said=$(printf '%s\n' "$ps_out" | head -n 3 | tr '\n' ' ')
  [ -z "${said// /}" ] || fail "docker compose in $COPY said: ${said}"
  fail "$COPY has no portal-bff container: start the stack once (docker compose up -d), or make it without starting it (docker compose up --no-start)"
fi
state=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$cid")
logs=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/log/portal"}}{{.Name}}{{end}}{{end}}' "$cid")
image=$(docker inspect -f '{{.Config.Image}}' "$cid")
[ -n "$state" ] && [ -n "$logs" ] || fail "the portal-bff container of $COPY does not mount the volumes /data and /var/log/portal"

# A folder that is there already is not changed: it may be one that others read for a reason of their own. One this script makes is for the copies alone.
if [ ! -d "$DEST" ]; then
  mkdir -p "$DEST"
  chmod 700 "$DEST"
fi
read_passphrase confirm
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$DEST/hcml-$COPY-state-$stamp.tar.gz.enc"

say "Copying the volumes $state and $logs of $COPY."
PARTIAL="$out.partial"
docker run --rm --network none --read-only --entrypoint tar -v "$state:/state:ro" -v "$logs:/logs:ro" "$image" -cz -C / state logs | encrypt >"$out.partial"
decrypt <"$out.partial" | gzip -t || {
  rm -f "$out.partial"
  fail "the copy did not read back, so it was not kept"
}
mv "$out.partial" "$out"
PARTIAL=""
sha256_of "$out" >"$out.sha256"
say "Wrote $out ($(size_of "$out") bytes) and its checksum. It holds users.json, which holds password hashes: treat it as a secret."

if [ "$ENV" = 1 ]; then
  files=()
  for f in .env server/.env docker-compose.override.yml; do [ -f "$ROOT/$f" ] && files+=("$f"); done
  [ ${#files[@]} -gt 0 ] || fail "there is no .env or docker-compose.override.yml in $COPY"
  env_out="$DEST/hcml-$COPY-env-$stamp.tar.gz.enc"
  # gzip is run apart because bsdtar on a Mac pads `tar -z` with zeros, which `gzip -t` reads as damage.
  PARTIAL="$env_out.partial"
  COPYFILE_DISABLE=1 tar -c -C "$ROOT" "${files[@]}" | gzip | encrypt >"$env_out.partial"
  decrypt <"$env_out.partial" | gzip -t || {
    rm -f "$env_out.partial"
    fail "the copy of the settings did not read back, so it was not kept"
  }
  mv "$env_out.partial" "$env_out"
  PARTIAL=""
  sha256_of "$env_out" >"$env_out.sha256"
  say "Wrote $env_out (${files[*]}). It holds the tokens and the signing secret: keep its passphrase apart from the file."
fi

# Keep the newest $KEEP copies of the volumes.
# By the UTC stamp in the name, newest first, and not by the time of the file: a folder of copies that was copied to another machine has the times of the copying.
old=$(ls -1 "$DEST"/hcml-"$COPY"-state-*.tar.gz.enc 2>/dev/null | sort -r | tail -n +"$((KEEP + 1))" || true)
if [ -n "$old" ]; then
  printf '%s\n' "$old" | while IFS= read -r f; do rm -f "$f" "$f.sha256"; done
  say "Deleted $(printf '%s\n' "$old" | wc -l | tr -d ' ') older copy of the volumes (BACKUP_KEEP=$KEEP)."
fi
say "Now copy $DEST off this machine. Test a copy with: deploy/backup-state.sh --check $out"
