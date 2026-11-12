#!/usr/bin/env bash
# Rebuild the portals from the commit in this folder, hosted copy first and then the local-model copy
# beside it, and check what came up (tracker IN-01; the steps are the ones in docs/setup/23).
#
#   deploy/rebuild.sh [--dry-run] [--skip-verify] [--allow-dirty] [--mark-good]
#
#   --dry-run      print every command that would change something, and run none of them
#   --skip-verify  do not run `npm run verify` first (it takes about five minutes)
#   --allow-dirty  build although server/, web/ or docker-compose.yml differ from the commit; the
#                  build is then labelled <commit>-dirty and is not tagged
#   --mark-good    build nothing: keep the images that run now as last-good, the build to go back to if a
#                  later run fails. The image is the one each container runs (its id), not whatever :latest names; with no
#                  container, :latest, which is what `docker compose up` would start.
#                  Run it once the check that needs a sign-in has passed.
#
# It refuses to run from a tree whose server/, web/ (their tests apart, which no image holds) or
# docker-compose.yml differ from HEAD: the build is named by the commit, and a name that lies is worse
# than none. A folder with no git is built too, labelled "unknown", and gets no live tag. It saves the logs of the
# running containers (LOG_ARCHIVE_DIR, default ~/.local/state/hcml-portal-logs, the newest LOG_ARCHIVE_KEEP of each
# project, default 30), since a new container starts with an empty log. It tags the images it replaces
# rollback-<day><month>, builds with BUILD_COMMIT and BUILD_TIME, waits for both containers of each copy to be healthy
# and asks what an anonymous caller can see. A copy that fails those checks stops the run before the next copy is
# touched. On a clean tree it makes the annotated tag live-<date> in this repository (it never pushes it: that is yours
# to do). Then it prints the check that needs a sign-in, which it cannot make. It does not mark last-good: a build that
# has passed the checks it can make may still fail that one.
set -euo pipefail

DRY=0
VERIFY=1
DIRTY_OK=0
MARK=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --skip-verify) VERIFY=0 ;;
    --allow-dirty) DIRTY_OK=1 ;;
    --mark-good) MARK=1 ;;
    -h | --help)
      sed -n '2,/^set -euo pipefail/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "rebuild.sh: unknown option $arg" >&2
      exit 2
      ;;
  esac
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PARENT=$(dirname "$ROOT")

say() { printf '%s\n' "$*"; }
fail() {
  printf 'rebuild.sh: %s\n' "$*" >&2
  exit 1
}
# Print a command, then run it unless this is a dry run.
run() {
  printf '+ %s\n' "$*"
  if [ "$DRY" -eq 0 ]; then "$@"; fi
}

# The name Compose gives a folder's containers and images: the name: line of its docker-compose.yml, else the folder's
# name in lower case, which is what Compose itself falls back to. A clone of the repository need not be called hcml-portal.
project_of() {
  local n
  n=$(sed -n 's/^name:[[:space:]]*//p' "$1/docker-compose.yml" 2>/dev/null | head -1 | tr -d "\"' ")
  if [ -n "$n" ]; then printf '%s' "$n"; else basename "$1" | tr '[:upper:]' '[:lower:]'; fi
}

COPIES=("$ROOT")
if [ "$(project_of "$ROOT")" = hcml-portal ] && [ -f "$PARENT/hcml-portal-ollama/docker-compose.yml" ]; then
  COPIES+=("$PARENT/hcml-portal-ollama")
fi

# The images that run now become the ones a later failed run points back to. Not part of a build: it asks for no git.
# The image is the one the container runs, by its id: :latest can have moved on since, after a build by hand or a rollback tag moved without `up`.
if [ "$MARK" -eq 1 ]; then
  MARKED=0
  for C in "${COPIES[@]}"; do
    P=$(project_of "$C")
    for IMG in "$P-portal-bff" "$P-portal-web"; do
      if ID=$(docker inspect -f '{{.Image}}' "$IMG-1" 2>/dev/null) && [ -n "$ID" ]; then
        run docker tag "$ID" "$IMG:last-good"
        MARKED=$((MARKED + 1))
      elif docker image inspect "$IMG:latest" >/dev/null 2>&1; then
        # Nothing runs (after `docker compose down`, say), so no running image can be named: :latest is what `docker compose up` would start.
        say "no container $IMG-1: marking the image :latest, which is what \`docker compose up\` would start"
        run docker tag "$IMG:latest" "$IMG:last-good"
        MARKED=$((MARKED + 1))
      else
        say "no $IMG:latest to mark"
      fi
    done
  done
  say ""
  if [ "$MARKED" -eq 0 ]; then
    say "Nothing was marked: there is no container of the portals and no image of them here."
    exit 1
  fi
  if [ "$DRY" -eq 1 ]; then say "Dry run: nothing was changed."; else say "Marked. A later run that fails points back to these."; fi
  exit 0
fi

HAVE_GIT=1
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  SHA=$(git -C "$ROOT" rev-parse --short HEAD)
  # What goes into the images: server/ and web/, less their tests, and the compose file.
  IMAGE_FILES=(server web docker-compose.yml ':(exclude,glob)**/__tests__/**' ':(exclude,glob)**/*.test.ts' ':(exclude,glob)**/*.test.tsx')
  CHANGED=$(git -C "$ROOT" status --porcelain -- "${IMAGE_FILES[@]}" | wc -l | tr -d ' ')
  LABEL=$SHA
  if [ "$CHANGED" -gt 0 ]; then
    [ "$DIRTY_OK" -eq 1 ] ||
      fail "server/, web/ (apart from their tests) or docker-compose.yml differ from $SHA ($CHANGED paths). Commit them, or pass --allow-dirty for a build labelled $SHA-dirty."
    LABEL="$SHA-dirty"
  fi
else
  # A folder with no git has no commit to name the build and nothing to compare the tree with.
  HAVE_GIT=0
  SHA=unknown
  LABEL=unknown
  say "$ROOT is not a git checkout, so this build is labelled \"unknown\" and no live tag is made."
fi
TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# The month: the web image takes the operating system's fixes again when it changes (IN-75).
ROUND=$(date -u +%Y-%m)

say "Build $LABEL, $TIME, for: $(for c in "${COPIES[@]}"; do basename "$c"; done | tr '\n' ' ')"
if [ "$DRY" -eq 1 ]; then say "Dry run: nothing is changed."; fi

if [ "${#COPIES[@]}" -gt 1 ]; then
  say ""
  say "Gate: the two copies hold the same files, apart from the ones meant to differ"
  run node "$ROOT/tools/check/parity.check.mjs"
fi
if [ "$VERIFY" -eq 1 ]; then
  say ""
  say "Gate: npm run verify (typecheck, lint, tests, builds, the checkers)"
  run npm --prefix "$ROOT" run verify
fi
# A .env line docker cannot parse stopped the 26 October rebuild only after the images were tagged
# (tracker IN-38). Docker's message can quote that line, and a secret with it, so only its number is shown.
for C in "${COPIES[@]}"; do
  say ""
  say "Gate: docker can read the settings of $(basename "$C")"
  if out=$(docker compose --project-directory "$C" config --quiet 2>&1); then
    say "  ok"
  else
    # No line number in the message makes grep fail, and under pipefail that would end the script with no word.
    at=$(printf '%s' "$out" | grep -oE 'line [0-9]+' | head -1) || true
    fail "docker cannot read the settings of $(basename "$C")${at:+ ($at of its .env)}. Fix it in an editor; docker's own message is not shown, as it may quote a secret."
  fi
done

# A new container starts with an empty log, and the old one goes with the container it belonged to: keep a compressed copy
# of each copy's logs first, in a folder of its own, the newest LOG_ARCHIVE_KEEP of each project. The folder is outside the
# repository; how long to keep logs is for whoever runs the portal to decide. A copy that cannot give its logs does not stop the build.
LOG_ARCHIVE=${LOG_ARCHIVE_DIR:-$HOME/.local/state/hcml-portal-logs}
LOG_KEEP=${LOG_ARCHIVE_KEEP:-30}
case $LOG_KEEP in '' | *[!0-9]* | ??????????*) LOG_KEEP=30 ;; esac # digits only, nine at most
LOG_KEEP=$((10#$LOG_KEEP))                                           # 08 is eight, not a bad octal
[ "$LOG_KEEP" -ge 1 ] || LOG_KEEP=1                                  # none would remove the file just written
archive_logs() { # folder of the copy, its project
  local stamp out f
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  out="$LOG_ARCHIVE/$2-$stamp.log.gz"
  say "Saving the logs of $2 to $out"
  if [ "$DRY" -eq 1 ]; then return 0; fi
  # The logs hold the names typed at sign-in, addresses and the text of searches: private to whoever runs this.
  (umask 077 && mkdir -p "$LOG_ARCHIVE") 2>/dev/null || {
    say "  could not make $LOG_ARCHIVE; going on without the logs of $2"
    return 0
  }
  if (umask 077 && docker compose --project-directory "$1" logs --no-color --timestamps 2>/dev/null | gzip >"$out" && [ "${PIPESTATUS[0]}" -eq 0 ]); then
    # Only this project's files: "hcml-portal-" followed by a digit, so hcml-portal-ollama's are left alone.
    # The newest are by name, which holds the UTC time of the save: a copied folder has new modification times.
    ls -1 -- "$LOG_ARCHIVE"/"$2"-[0-9]*.log.gz 2>/dev/null | sort -r | tail -n +$((LOG_KEEP + 1)) | while IFS= read -r f; do rm -f -- "$f"; done || true
  else
    rm -f "$out"
    say "  could not save the logs of $2; going on without them"
  fi
}

DAY=$(LC_ALL=C date +%d%b | tr '[:upper:]' '[:lower:]' | sed 's/^0//')
# The first rollback-<day><month> tag of this image that is free: rollback-22oct, then rollback-22oct-2.
# It gives up at 50, so a docker that says every tag exists cannot keep the script looping.
free_tag() {
  local tag="rollback-$DAY" n=1
  while [ "$n" -lt 50 ] && docker image inspect "$1:$tag" >/dev/null 2>&1; do
    n=$((n + 1))
    tag="rollback-$DAY-$n"
  done
  printf '%s' "$tag"
}

KEPT=()
# The copies that came up and passed their checks in this run, so that the help can say which copy runs which build.
BUILT=()
# Where to go back to. last-good is the build someone marked good with --mark-good; the rollback tags hold the images this run
# replaced, under the names free_tag gave them; if the run before this one failed, they hold its failed build.
rollback_help() { # the project that failed
  local t img good=() p
  say ""
  # A failure of the second copy leaves the first one on the new build: going back with it would undo a copy that is fine.
  for p in ${BUILT[@]+"${BUILT[@]}"}; do
    say "$p already runs the new build and passed its checks. Leave it as it is unless you mean to go back with it."
  done
  if [ "${#BUILT[@]}" -gt 0 ] && [ -n "${1:-}" ]; then
    say "$1 is the one that failed: a build that did not finish leaves its old containers running, and one that finished may run unhealthy."
    say ""
  fi
  if [ "${#KEPT[@]}" -eq 0 ]; then
    say "No image was tagged for a rollback: none existed before this run."
    return
  fi
  for t in "${KEPT[@]}"; do
    img=${t%:*}
    if docker image inspect "$img:last-good" >/dev/null 2>&1; then good+=("$img:last-good"); fi
  done
  if [ "${#good[@]}" -gt 0 ]; then
    say "The last build marked good (deploy/rebuild.sh --mark-good) is kept as:"
    for t in "${good[@]}"; do say "  $t"; done
    say "To go back to it: docker tag <image>:last-good <image>:latest for each, then docker compose up -d --no-build in that copy"
    say ""
    say "The images this run replaced are kept under these tags (setup 23, Rolling back); if the run before this one failed, they are its failed build:"
    for t in "${KEPT[@]}"; do say "  $t"; done
    return
  fi
  say "The images this replaced are kept under these tags (setup 23, Rolling back):"
  for t in "${KEPT[@]}"; do say "  $t"; done
  say "To go back: docker tag <image>:<tag> <image>:latest for each, then docker compose up -d --no-build in that copy"
}

wait_healthy() {
  local state=missing i
  for i in $(seq 1 60); do
    state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || echo missing)
    if [ "$state" = healthy ]; then return 0; fi
    sleep 3
  done
  say "  $1 is $state after 180 seconds"
  return 1
}

FAILED=0
SIGNIN=''
expect() { # what, wanted, got
  if [ "$2" = "$3" ]; then
    say "  ok    $1 ($3)"
  else
    say "  FAIL  $1: wanted $2, got $3"
    FAILED=1
  fi
}
status_of() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@" || true; }

for C in "${COPIES[@]}"; do
  P=$(project_of "$C")
  say ""
  say "== $P"
  archive_logs "$C" "$P"
  for IMG in "$P-portal-bff" "$P-portal-web"; do
    if docker image inspect "$IMG:latest" >/dev/null 2>&1; then
      FREE=$(free_tag "$IMG")
      run docker tag "$IMG:latest" "$IMG:$FREE"
      KEPT+=("$IMG:$FREE")
    else
      say "no $IMG:latest yet, so nothing is kept for a rollback"
    fi
  done
  if ! run env BUILD_COMMIT="$LABEL" BUILD_TIME="$TIME" APK_ROUND="$ROUND" docker compose --project-directory "$C" up -d --build; then
    say ""
    say "docker compose could not bring $P up."
    rollback_help "$P"
    exit 1
  fi
  if [ "$DRY" -eq 1 ]; then continue; fi

  say "Waiting for $P to be healthy"
  wait_healthy "$P-portal-bff-1" || FAILED=1
  wait_healthy "$P-portal-web-1" || FAILED=1
  # docker port exits 1 for a container that is stopped or restarting, and set -e would end the run here with no word of how to go back.
  PORT=$(docker port "$P-portal-web-1" 8080/tcp 2>/dev/null | head -1 | sed 's/.*://' || true)
  case $PORT in
    '' | *[!0-9]*)
      say "  FAIL  $P-portal-web-1 publishes no port 8080, so it is not running: its checks cannot be made"
      say ""
      say "Something above failed."
      rollback_help "$P"
      exit 1
      ;;
  esac
  BASE="http://127.0.0.1:$PORT"
  say "What an anonymous caller sees at $BASE"
  expect "the health route answers" 200 "$(status_of "$BASE/bff/api/health")"
  expect "the meters are refused" 401 "$(status_of "$BASE/bff/api/net/meters")"
  expect "/.env is not served" 404 "$(status_of "$BASE/.env")"
  expect "/.git/config is not served" 404 "$(status_of "$BASE/.git/config")"
  if curl -sI --max-time 20 "$BASE/" | grep -qi '^content-security-policy:'; then
    say "  ok    the page carries a Content-Security-Policy"
  else
    say "  FAIL  the page carries no Content-Security-Policy"
    FAILED=1
  fi
  say "  bundle: $(curl -s --max-time 20 "$BASE/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1)"
  say "  build:  $(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$P-portal-bff-1" | grep -E '^BUILD_(COMMIT|TIME)=' | tr '\n' ' ')"
  SIGNIN="$SIGNIN
  PORTAL_USER=... PORTAL_PASSWORD=... python3 -I tools/live/signedin_check.py $BASE"
  # A build that starts and is bad must not replace the next copy too: the first copy is the canary.
  if [ "$FAILED" -ne 0 ] && [ "$C" != "${COPIES[${#COPIES[@]} - 1]}" ]; then
    say ""
    say "Something above failed. $(basename "${COPIES[${#COPIES[@]} - 1]}") was not rebuilt, so one portal still runs the build it had."
    rollback_help "$P"
    exit 1
  fi
  if [ "$FAILED" -eq 0 ]; then BUILT+=("$P"); fi
done

if [ "$FAILED" -ne 0 ]; then
  say ""
  say "Something above failed."
  rollback_help "$P"
  exit 1
fi

if [ "$HAVE_GIT" -eq 1 ] && [ "$LABEL" = "$SHA" ]; then
  TAG="live-$(date +%Y-%m-%d)"
  n=1
  while git -C "$ROOT" rev-parse -q --verify "refs/tags/$TAG" >/dev/null; do
    n=$((n + 1))
    TAG="live-$(date +%Y-%m-%d)-$n"
  done
  say ""
  # The build is live by now: a tag that cannot be made (git has no name and address for this account) must not read as a failed run.
  if run git -C "$ROOT" tag -a "$TAG" "$SHA" -m "Live from $TIME: built from $SHA"; then
    say "The tag is local. To make it public: git push origin $TAG"
  else
    say "Could not make the tag $TAG: git needs a name and address (git config user.name, git config user.email). The build is live."
  fi
fi

say ""
if [ "$DRY" -eq 1 ]; then
  say "Dry run: nothing was changed."
else
  say "Still yours, because it needs a sign-in: open the Dashboard and Problems on each portal, then$SIGNIN"
  say ""
  say "When those pass, keep these images as the ones to go back to with: deploy/rebuild.sh --mark-good"
fi
