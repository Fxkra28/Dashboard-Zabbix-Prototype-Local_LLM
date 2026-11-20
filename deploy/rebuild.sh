#!/usr/bin/env bash
# Rebuild the portals from the commit in this folder, hosted copy first and then the local-model copy
# beside it, and check what came up (tracker IN-01; the steps are the ones in docs/setup/23).
#
#   deploy/rebuild.sh [--dry-run] [--skip-verify] [--allow-dirty] [--mark-good] [--prune-rollbacks=N]
#
#   --dry-run      print every command that would change something, and run none of them
#   --skip-verify  do not run `npm run verify` first (it takes about five minutes)
#   --allow-dirty  build although server/, web/ or docker-compose.yml differ from the commit; the
#                  build is then labelled <commit>-dirty and is not tagged
#   --mark-good    build nothing: keep the images that run now as last-good, the build to go back to if a
#                  later run fails. The image is the one each container runs (its id), not whatever :latest names; with no
#                  container, :latest, which is what `docker compose up` would start.
#                  Run it once the check that needs a sign-in has passed.
#   --prune-rollbacks=N  build nothing: keep the newest N rollback-* tags of each image and untag the older ones, which pile up with every rebuild (nine of each so far). N is yours to name
#                  and is never assumed. A tag that names the image that runs, or last-good, is kept whatever its place, and so are :latest and last-good themselves. Newest means made last, not first in Docker's list.
#
# It first asks Docker whether it is installed and running, so that a stopped Docker Desktop is said at once and not after minutes of tests.
# Docker gets 20 seconds to answer; REBUILD_DOCKER_TIMEOUT sets another number of seconds.
# It refuses to run from a copy whose server/, web/ (their tests apart, which no image holds) or
# docker-compose.yml differ from its own HEAD: each copy is a repository of its own, and the build is named by its commit, since a name that lies is worse
# than none. A copy with no git is built too, labelled "unknown", and gets no live tag. It runs `npm run verify` in each copy, one after the other. It saves the logs of the
# running containers (LOG_ARCHIVE_DIR, default ~/.local/state/hcml-portal-logs, the newest LOG_ARCHIVE_KEEP of each
# project, default 30), since a new container starts with an empty log. It tags the images it replaces
# rollback-<day><month>, builds with BUILD_COMMIT and BUILD_TIME, waits for both containers of each copy to be healthy
# and asks what an anonymous caller can see. A copy that fails those checks stops the run before the next copy is
# touched. For each copy with a clean tree it makes the annotated tag live-<date> in that copy's own repository (it never pushes it: that is yours
# to do). Then it prints the check that needs a sign-in, which it cannot make, with the expectations of each copy. It does not mark last-good: a build that
# has passed the checks it can make may still fail that one.
set -euo pipefail

DRY=0
VERIFY=1
DIRTY_OK=0
MARK=0
PRUNE=""
PRUNING=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --skip-verify) VERIFY=0 ;;
    --allow-dirty) DIRTY_OK=1 ;;
    --mark-good) MARK=1 ;;
    --prune-rollbacks=*) PRUNING=1; PRUNE=${arg#*=} ;;
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
  if [ "$DRY" -eq 0 ]; then (cd "${RUN_IN:-.}" && "$@"); fi
}
# Compose reads a COMPOSE_FILE line of the folder's .env, and takes the names in it from the folder it runs in: so every call that names a copy runs from that copy's folder, and a machine with an
# overlay (the virtual machine's Ollama) is rebuilt with it and does not leave its model service behind as an orphan (IN-100).
compose_in() { # folder, then the arguments of docker compose
  local dir=$1
  shift
  (cd "$dir" && docker compose --project-directory "$dir" "$@")
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

# A stopped Docker Desktop (IN-43) made every later command fail, after verify had run for minutes, and the help then said no image existed (IN-86).
# Docker gets REBUILD_DOCKER_TIMEOUT seconds (20) to answer. macOS has no timeout command, and an alarm does not stop the Docker CLI, a Go program that
# ignores SIGALRM, so the call runs in the background and is ended with TERM, then KILL, when the time is up (IN-89).
DOCKER_TIMEOUT=${REBUILD_DOCKER_TIMEOUT:-20}
case $DOCKER_TIMEOUT in '' | *[!0-9]* | ???????*) DOCKER_TIMEOUT=20 ;; esac
DOCKER_TIMEOUT=$((10#$DOCKER_TIMEOUT))
[ "$DOCKER_TIMEOUT" -ge 1 ] || DOCKER_TIMEOUT=20
docker_answers() {
  local pid waited=0
  docker info >/dev/null 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge $((DOCKER_TIMEOUT * 10)) ]; then
      # Grouped, so that bash 3.2's "Terminated" notice for the call it was told to end does not reach the screen.
      {
        kill -s TERM "$pid"
        sleep 1
        kill -s KILL "$pid"
        wait "$pid"
      } 2>/dev/null || true
      return 1
    fi
    if sleep 0.1 2>/dev/null; then waited=$((waited + 1)); else sleep 1; waited=$((waited + 10)); fi
  done
  wait "$pid"
}
command -v docker >/dev/null 2>&1 || fail "Docker is not installed here: no docker command is on the PATH. Install Docker Desktop, or put docker on the PATH, then run this again. Nothing was changed."
docker_answers || fail "Docker is not running (docker info failed or did not answer within $DOCKER_TIMEOUT seconds). Start Docker Desktop, wait until it says it is running, then run this again. Nothing was changed."

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

# The rollback tags of an image, newest first: by the second each was made, then by the -2, -3 of its name. Docker's own list is not that order for
# images made in the same second, as the web images are, and a prune that trusted it could untag the newest way back.
rollback_tags_newest_first() {
  local img=$1 tag made n
  while IFS= read -r tag; do
    made=$(docker image inspect -f '{{.Metadata.LastTagTime}}' "$img:$tag" 2>/dev/null || true)
    case $made in 0001-*) made='' ;; esac
    n=${tag##*-}
    case $n in *[!0-9]*) n=1 ;; esac
    printf '%s %05d %s\n' "${made:0:19}" "$((10#$n))" "$tag"
  done < <(docker image ls --format '{{.Tag}}' "$img" 2>/dev/null | grep -E '^rollback-[0-9]{1,2}[a-z]{3}(-[0-9]+)?$' || true) | LC_ALL=C sort -r | awk '{print $NF}'
}

# The rollback tags are a tag for each rebuild and each image, and nothing removes them. The number to keep is the owner's to name: a bad number is refused, and none is ever assumed (IN-108).
if [ "$PRUNING" -eq 1 ]; then
  case $PRUNE in '' | *[!0-9]* | ???????*) fail "--prune-rollbacks=N needs the number of rollback tags to keep for each image, a whole number of 1 or more; it is \"$PRUNE\"" ;; esac
  PRUNE=$((10#$PRUNE))
  [ "$PRUNE" -ge 1 ] || fail "--prune-rollbacks=N needs a whole number of 1 or more: with none kept there would be no way back"
  REMOVED=0
  for C in "${COPIES[@]}"; do
    P=$(project_of "$C")
    for IMG in "$P-portal-bff" "$P-portal-web"; do
      # What runs and what last-good names are never untagged: the way back stays whatever number is given.
      running=$(docker inspect -f '{{.Image}}' "$IMG-1" 2>/dev/null || true)
      good=$(docker image inspect -f '{{.Id}}' "$IMG:last-good" 2>/dev/null || true)
      n=0
      while IFS= read -r tag; do
        [ -n "$tag" ] || continue
        n=$((n + 1))
        [ "$n" -gt "$PRUNE" ] || continue
        id=$(docker image inspect -f '{{.Id}}' "$IMG:$tag" 2>/dev/null || true)
        if [ -n "$id" ] && { [ "$id" = "$running" ] || [ "$id" = "$good" ]; }; then
          say "keeping $IMG:$tag: it names the image that runs, or last-good"
          continue
        fi
        run docker rmi "$IMG:$tag"
        REMOVED=$((REMOVED + 1))
      done < <(rollback_tags_newest_first "$IMG")
    done
  done
  say ""
  if [ "$DRY" -eq 1 ]; then say "Dry run: nothing was changed. $REMOVED tag(s) would be removed, keeping the newest $PRUNE of each image."; else say "Removed $REMOVED rollback tag(s), keeping the newest $PRUNE of each image."; fi
  exit 0
fi

# Each copy is a repository of its own (the second since 11 November 2026), so each is judged, labelled and tagged by its own HEAD (IN-81).
# What goes into the images: server/ and web/, less their tests, and the compose file.
IMAGE_FILES=(server web docker-compose.yml ':(exclude,glob)**/__tests__/**' ':(exclude,glob)**/*.test.ts' ':(exclude,glob)**/*.test.tsx')
SHAS=()
LABELS=()
for C in "${COPIES[@]}"; do
  if git -C "$C" rev-parse --git-dir >/dev/null 2>&1; then
    sha=$(git -C "$C" rev-parse --short HEAD)
    changed=$(git -C "$C" status --porcelain -- "${IMAGE_FILES[@]}" | wc -l | tr -d ' ')
    label=$sha
    if [ "$changed" -gt 0 ]; then
      [ "$DIRTY_OK" -eq 1 ] ||
        fail "$(basename "$C"): server/, web/ (apart from their tests) or docker-compose.yml differ from $sha ($changed paths). Commit them with git add -A, not git commit -a, so that the new files go in, or pass --allow-dirty for a build labelled $sha-dirty."
      label="$sha-dirty"
    fi
  else
    # A folder with no git has no commit to name the build and nothing to compare the tree with.
    sha=unknown
    label=unknown
    say "$C is not a git checkout, so its build is labelled \"unknown\" and no live tag is made."
  fi
  SHAS+=("$sha")
  LABELS+=("$label")
done
TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# The month: the web image takes the operating system's fixes again when it changes (IN-75).
ROUND=$(date -u +%Y-%m)

say "Build ${LABELS[0]}, $TIME, for: $(for c in "${COPIES[@]}"; do basename "$c"; done | tr '\n' ' ')"
for i in "${!COPIES[@]}"; do
  if [ "$i" -gt 0 ]; then say "  $(basename "${COPIES[$i]}") is labelled ${LABELS[$i]}"; fi
done
if [ "$DRY" -eq 1 ]; then say "Dry run: nothing is changed."; fi

if [ "${#COPIES[@]}" -gt 1 ]; then
  say ""
  say "Gate: the two copies hold the same files, apart from the ones meant to differ"
  run node "$ROOT/tools/check/parity.check.mjs"
fi
if [ "$VERIFY" -eq 1 ]; then
  # One copy after the other: two at once make the slower tests time out. Each copy is tested as it is, with its own installed packages (IN-81).
  for C in "${COPIES[@]}"; do
    say ""
    say "Gate: npm run verify in $(basename "$C") (typecheck, lint, tests, builds, the checkers)"
    run npm --prefix "$C" run verify
  done
fi
# A .env line docker cannot parse stopped the 26 October rebuild only after the images were tagged
# (tracker IN-38). Docker's message can quote that line, and a secret with it, so only its number is shown.
for C in "${COPIES[@]}"; do
  say ""
  say "Gate: docker can read the settings of $(basename "$C")"
  if out=$(compose_in "$C" config --quiet 2>&1); then
    say "  ok"
  elif printf '%s' "$out" | grep -q '\.env'; then
    # No line number in the message makes grep fail, and under pipefail that would end the script with no word.
    at=$(printf '%s' "$out" | grep -oE 'line [0-9]+' | head -1) || true
    fail "docker cannot read the settings of $(basename "$C")${at:+ (Docker names $at of its .env)}. Fix it in an editor; docker's own message is not shown, as it may quote a secret."
  else
    # Only a message about a .env file can quote a secret; one about docker-compose.yml is shown, so that the operator is sent to the right file (IN-90).
    fail "docker cannot read the settings of $(basename "$C"). Docker says: $(printf '%s' "$out" | head -c 400 | tr '\n' ' ')"
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
  if (umask 077 && compose_in "$1" logs --no-color --timestamps 2>/dev/null | gzip >"$out" && [ "${PIPESTATUS[0]}" -eq 0 ]); then
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
# What an older image cannot read: the people made on the Users page are in users.json in the volume portal-state (DC-69).
users_note() {
  say ""
  say "Before you go back to an image of before 18 November 2026: the people made on the Users page are in users.json, in the volume portal-state. An image from before 17 November does not read that file, and one from before 18 November cannot read an Argon2id hash (it takes the text for a plain password), so those people cannot sign in until they are added again in .env. Take a copy first with deploy/backup-state.sh."
}

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
    users_note
    return
  fi
  say "The images this replaced are kept under these tags (setup 23, Rolling back):"
  for t in "${KEPT[@]}"; do say "  $t"; done
  say "To go back: docker tag <image>:<tag> <image>:latest for each, then docker compose up -d --no-build in that copy"
  users_note
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

N=-1
for C in "${COPIES[@]}"; do
  N=$((N + 1))
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
  if ! RUN_IN="$C" run env BUILD_COMMIT="${LABELS[$N]}" BUILD_TIME="$TIME" APK_ROUND="$ROUND" docker compose --project-directory "$C" up -d --build; then
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
  # The copy that exists so that no question leaves the machine is checked for exactly that: a model that is local and answers (IN-79).
  EXPECT=''
  if [ "$P" = hcml-portal-ollama ]; then EXPECT=' --expect-ai local'; fi
  SIGNIN="$SIGNIN
  python3 -I tools/live/signedin_check.py $BASE$EXPECT"
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

# A live tag for each copy whose tree is clean, in that copy's own repository.
for i in "${!COPIES[@]}"; do
  C=${COPIES[$i]}
  if [ "${LABELS[$i]}" != "${SHAS[$i]}" ] || [ "${SHAS[$i]}" = unknown ]; then continue; fi
  TAG="live-$(date +%Y-%m-%d)"
  n=1
  while git -C "$C" rev-parse -q --verify "refs/tags/$TAG" >/dev/null; do
    n=$((n + 1))
    TAG="live-$(date +%Y-%m-%d)-$n"
  done
  say ""
  # The build is live by now: a tag that cannot be made (git has no name and address for this account) must not read as a failed run.
  if run git -C "$C" tag -a "$TAG" "${SHAS[$i]}" -m "Live from $TIME: built from ${SHAS[$i]}"; then
    say "The tag is local, in $(basename "$C"). To make it public: git -C $C push origin $TAG"
  else
    say "Could not make the tag $TAG in $(basename "$C"): git needs a name and address (git config user.name, git config user.email). The build is live."
  fi
done

say ""
if [ "$DRY" -eq 1 ]; then
  say "Dry run: nothing was changed."
else
  say "Still yours, because it needs a sign-in: open the Dashboard and Problems on each portal. Then read the sign-in into the shell, which keeps the password out of its history, and run the check on each:"
  say "  read -r PORTAL_USER; read -rs PORTAL_PASSWORD; export PORTAL_USER PORTAL_PASSWORD$SIGNIN"
  say ""
  say "When those pass, keep these images as the ones to go back to with: deploy/rebuild.sh --mark-good"
fi
