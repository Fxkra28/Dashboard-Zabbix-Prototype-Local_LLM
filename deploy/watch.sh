#!/usr/bin/env bash
# Watch the portals from outside Docker, and say so when one goes down, comes back, or restarts in a loop
# (tracker IN-31). Docker's healthchecks restart a dead container, but tell nobody.
#
#   deploy/watch.sh --once        check once; what a timer runs every minute
#   deploy/watch.sh --install     on macOS, run --once every minute as a LaunchAgent of this user
#   deploy/watch.sh --uninstall   remove that LaunchAgent
#   deploy/watch.sh --status      the last state, the time of the last run and the last lines of the log; exits 1
#                                 when there has been no run for five minutes (or ever), which a check from outside can use
#
# Settings, from the environment:
#   WATCH_URLS        portal addresses, space separated (default: this copy's, :8081 for hcml-portal and :8082 for
#                     hcml-portal-ollama, and the copy beside it when that sits next to this one)
#   WATCH_CONTAINERS  containers to check (default: the two of each of those copies); empty checks none
#   WATCH_STATE_DIR   where the state and the log are kept (default ~/.local/state/hcml-portal-watch)
#   WATCH_NOTIFY_CMD  a command line run with the message as its last argument, instead of the desktop
#                     notification: on a server, for example, a script that mails it
#   WATCH_DOCKER_TIMEOUT  seconds a call to Docker, or the notification, may take before it counts as not answering (default 20);
#                     at the end of it the call and everything it started are stopped
#
# A portal counts as down after two failed checks in a row, Docker as not answering the same, and a container is told as
# stopped, paused, dead, created, restarting or removing on the second check in a row, so a rebuild's restart is not news.
# A portal that answers but says ready:false in its health reply cannot read Zabbix: told on the second check in a row too.
# A change is recorded only once the notification of it was delivered (the command exited 0): if the mail relay or the desktop
# is down, or does not answer within the time limit, the next check says it again, until it gets through. Every run writes the
# time to STATE_DIR/heartbeat. A run that finds another one under way stops at once: a timer started every minute cannot pile runs up.
# It only reads: GET /bff/api/health, which needs no sign-in, and `docker info` and `docker inspect`.
set -u
# Docker Desktop on a Mac puts its command in ~/.docker/bin, which a LaunchAgent's or cron's short path may not hold.
PATH="$PATH:$HOME/.docker/bin"

STATE_DIR=${WATCH_STATE_DIR:-$HOME/.local/state/hcml-portal-watch}
# Without settings: the copy this script sits in and the copy beside it, so a VM that holds one copy is not told
# that the other one is missing. A folder whose project has another name gets the Mac layout, both copies.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# The name Compose gives a folder's containers: the name: line of its docker-compose.yml, else the folder's name in lower case.
project_of() {
  local n
  n=$(sed -n 's/^name:[[:space:]]*//p' "$1/docker-compose.yml" 2>/dev/null | head -1 | tr -d "\"' ")
  if [ -n "$n" ]; then printf '%s' "$n"; else basename "$1" | tr '[:upper:]' '[:lower:]'; fi
}
DEFAULT_URLS=""
DEFAULT_CONTAINERS=""
for copy in hcml-portal hcml-portal-ollama; do
  if [ "$(project_of "$ROOT")" = "$copy" ] || [ -f "$(dirname "$ROOT")/$copy/docker-compose.yml" ]; then
    port=8081
    [ "$copy" = hcml-portal-ollama ] && port=8082
    DEFAULT_URLS="$DEFAULT_URLS http://127.0.0.1:$port"
    DEFAULT_CONTAINERS="$DEFAULT_CONTAINERS $copy-portal-bff-1 $copy-portal-web-1"
  fi
done
[ -n "$DEFAULT_URLS" ] || {
  DEFAULT_URLS="http://127.0.0.1:8081 http://127.0.0.1:8082"
  DEFAULT_CONTAINERS="hcml-portal-portal-bff-1 hcml-portal-portal-web-1 hcml-portal-ollama-portal-bff-1 hcml-portal-ollama-portal-web-1"
}
URLS=${WATCH_URLS-$DEFAULT_URLS}
CONTAINERS=${WATCH_CONTAINERS-$DEFAULT_CONTAINERS}
DOCKER_TIMEOUT=${WATCH_DOCKER_TIMEOUT:-20}
case $DOCKER_TIMEOUT in '' | *[!0-9]*) DOCKER_TIMEOUT=20 ;; *) [ ${#DOCKER_TIMEOUT} -le 6 ] && DOCKER_TIMEOUT=$((10#$DOCKER_TIMEOUT)) || DOCKER_TIMEOUT=20 ;; esac
[ "$DOCKER_TIMEOUT" -ge 1 ] || DOCKER_TIMEOUT=20
LABEL=id.hcml.portal-watch
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
STATE="$STATE_DIR/state"
LOG="$STATE_DIR/watch.log"
HEARTBEAT="$STATE_DIR/heartbeat"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG"; }

# Tell someone, and return 0 only if it got through: the caller records a change as told only then, so that a command that is
# down (a mail relay, a desktop that blocks notifications) gets the same news again at the next check. With no way to tell
# anyone there is nothing to retry: the log line is the record, and that counts as delivered.
notify() {
  local rc=0
  log "notify: $1"
  # Each way of telling is limited like a call to Docker: a mail command that waits on a stalled relay must not hold the run.
  if [ -n "${WATCH_NOTIFY_CMD:-}" ]; then
    # Read as a command line, so that its arguments and quotes work, with the message as its last argument, whole.
    limited bash -c "$WATCH_NOTIFY_CMD \"\$1\"" watch-notify "$1" || rc=$?
  elif command -v osascript >/dev/null 2>&1; then
    limited osascript -e "display notification \"$1\" with title \"HCML portal\" sound name \"Funk\"" || rc=$?
  elif command -v notify-send >/dev/null 2>&1; then
    limited notify-send "HCML portal" "$1" || rc=$?
  else
    log "nobody can be told from here: set WATCH_NOTIFY_CMD"
  fi
  [ "$rc" -eq 0 ] || log "notify failed (exit $rc), will try again at the next check"
  return "$rc"
}

# The value of `key` in the state file, or $2 when it has none.
get() { awk -v k="$1" '$1 == k { v = $2 } END { if (v != "") print v }' "$STATE" 2>/dev/null | grep . || printf '%s' "$2"; }
NEXT=""
put() { NEXT="$NEXT$1 $2"$'\n'; }
# A whole number, or 0: a value in a hand-edited state file must not stop the run in an arithmetic test.
# 10# keeps a leading zero from being read as octal.
num() { case $1 in '' | *[!0-9]*) printf 0 ;; *) [ ${#1} -le 9 ] && printf '%s' "$((10#$1))" || printf 0 ;; esac; }

# Run a command and leave what it printed in LIMITED_OUT; give up on it after DOCKER_TIMEOUT seconds (status 124).
# macOS has no timeout command; a Docker Desktop that hangs would otherwise hold this run, and launchd starts no second one.
# Not run in a command substitution, so that a signal to this script can reach the call (cleanup below).
#
# The call leads a process group of its own, and the limit and a signal end the whole group: bash does not replace `sleep 300; true`,
# or a wrapper script around a mailer, with its last command, so ending only the first process left its children running (IN-73).
# macOS has no setsid; perl, which it and Debian both have, does the same with setpgrp. Without perl the call runs as before, and the limit ends only its first process.
# A call in a group of its own is not in the one launchd cleans up when a job is killed (SIGKILL): TERM and INT are handled by `cleanup`, which ends the group.
GROUPED=0
command -v perl >/dev/null 2>&1 && GROUPED=1
CHILD=''
SCRATCH=''
LIMITED_OUT=''
# Send a signal to the call in hand: to its group when it leads one, else to the process alone.
stop_call() {
  if [ "$GROUPED" -eq 1 ]; then
    kill -s "$1" -- "-$CHILD" 2>/dev/null || kill -s "$1" "$CHILD" 2>/dev/null
  else
    kill -s "$1" "$CHILD" 2>/dev/null
  fi
}
limited() {
  local rc=0 waited=0 i
  LIMITED_OUT=''
  # A full or read-only state folder is no reason to call Docker down: take the scratch file from the temp folder, or run without a limit.
  SCRATCH=$(mktemp "$STATE_DIR/call.XXXXXX" 2>/dev/null || mktemp "${TMPDIR:-/tmp}/hcml-watch-call.XXXXXX" 2>/dev/null) || {
    SCRATCH=''
    LIMITED_OUT=$("$@" 2>/dev/null)
    return $?
  }
  if [ "$GROUPED" -eq 1 ]; then
    # exec with a block never hands the line to a shell, whatever the arguments hold.
    perl -e 'setpgrp(0, 0); exec { $ARGV[0] } @ARGV or exit 127' -- "$@" >"$SCRATCH" 2>/dev/null &
  else
    "$@" >"$SCRATCH" 2>/dev/null &
  fi
  CHILD=$!
  while kill -0 "$CHILD" 2>/dev/null; do
    if [ "$waited" -ge $((DOCKER_TIMEOUT * 20)) ]; then
      stop_call TERM
      for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
        kill -0 "$CHILD" 2>/dev/null || break
        sleep 0.05 2>/dev/null || sleep 1
      done
      # Before the first process is reaped, so that its number is still ours: children may outlive it, or ignore TERM.
      stop_call KILL
      wait "$CHILD" 2>/dev/null
      rm -f "$SCRATCH"
      SCRATCH=''
      CHILD=''
      return 124
    fi
    if sleep 0.05 2>/dev/null; then waited=$((waited + 1)); else sleep 1; waited=$((waited + 20)); fi
  done
  wait "$CHILD" || rc=$?
  LIMITED_OUT=$(cat "$SCRATCH")
  rm -f "$SCRATCH"
  SCRATCH=''
  CHILD=''
  return "$rc"
}

# On a signal or at the end: stop the call in hand (and end it if it ignores TERM), and leave no scratch or new-state file behind.
NEWSTATE=''
cleanup() {
  local i
  if [ -n "$CHILD" ]; then
    stop_call TERM
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
      kill -0 "$CHILD" 2>/dev/null || break
      sleep 0.05 2>/dev/null || sleep 1
    done
    # The whole group goes, since children may outlive the first process. Reaped here, so that bash does not report "Killed" on stderr, which launchd would keep in launchd.err.
    stop_call KILL
    wait "$CHILD" 2>/dev/null
  fi
  [ -n "$SCRATCH" ] && rm -f "$SCRATCH"
  [ -n "$NEWSTATE" ] && rm -f "$NEWSTATE"
  [ "$HELD" -eq 1 ] && rm -rf "$LOCK"
  # A signal runs this, then the EXIT trap runs it again: the second run must find nothing to do.
  CHILD=''
  SCRATCH=''
  NEWSTATE=''
  HELD=0
  return 0
}

# One run at a time. mkdir is atomic, so of two runs that start together one gets the lock. A lock whose run is dead, or that is
# older than a quarter of an hour (a process id reused by something else), is taken over; a run that cannot make a lock here goes on without.
LOCK="$STATE_DIR/lock"
HELD=0
take_lock() {
  local pid
  mkdir -p "$STATE_DIR" 2>/dev/null
  if mkdir "$LOCK" 2>/dev/null; then
    printf '%s\n' "$$" >"$LOCK/pid"
    HELD=1
    return 0
  fi
  [ -d "$LOCK" ] || return 0
  pid=$(head -n 1 "$LOCK/pid" 2>/dev/null)
  # A run that has just made the lock has not written its number yet.
  [ -n "$pid" ] || { sleep 0.3 2>/dev/null || sleep 1; pid=$(head -n 1 "$LOCK/pid" 2>/dev/null); }
  case $pid in '' | *[!0-9]*) pid=0 ;; esac
  if [ "$pid" -gt 0 ] && kill -0 "$pid" 2>/dev/null && [ -z "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then
    return 1
  fi
  rm -rf "$LOCK"
  if mkdir "$LOCK" 2>/dev/null; then
    printf '%s\n' "$$" >"$LOCK/pid"
    HELD=1
    return 0
  fi
  return 1
}

# Docker that does not answer is told on the second check in a row, like a portal: Docker that is slow once is not news.
docker_down() {
  local bad
  local told
  bad=$(($(num "$(get docker.bad 0)") + 1))
  put docker.bad "$bad"
  told=$(get docker up)
  if [ "$bad" -ge 2 ] && [ "$told" = up ]; then
    notify "Docker is not answering on this machine, so the portals cannot run. Start Docker." && told=down
  fi
  put docker "$told"
  # What was last known of each container stays known while Docker is away, so a recovery is still told when it comes.
  for c in $CONTAINERS; do
    put "$c" "$(get "$c" healthy)"
    put "$c.bad" "$(get "$c.bad" 0)"
    put "$c.restarts" "$(get "$c.restarts" 0)"
  done
}

check() {
  mkdir -p "$STATE_DIR"
  touch "$STATE"

  for url in $URLS; do
    key=$(printf '%s' "$url" | tr -c 'A-Za-z0-9' '_')
    body=$(curl -s --max-time 10 "$url/bff/api/health" 2>/dev/null || true)
    case "$body" in *'"ok":true'*) now=up ;; *) now=down ;; esac
    was=$(get "$key" up)
    fails=$(num "$(get "$key.fails" 0)")
    told=$was
    if [ "$now" = up ]; then
      [ "$was" = down ] && { notify "The portal at $url answers again." && told=up; }
      [ "$was" = down ] || told=up
      put "$key" "$told"
      put "$key.fails" 0
    else
      fails=$((fails + 1))
      if [ "$fails" -ge 2 ] && [ "$was" = up ]; then
        notify "The portal at $url is not answering (checked twice, a minute apart)." && told=down
      fi
      put "$key" "$told"
      put "$key.fails" "$fails"
    fi

    # Alive but unable to read Zabbix: the page loads and every figure fails. The health reply says it to anyone as ready:false.
    # A portal built before the field says nothing, which counts as ready; a portal that is down keeps what was last told.
    zwas=$(get "$key.zabbix" ok)
    zfails=$(num "$(get "$key.zfails" 0)")
    if [ "$now" = up ]; then
      case "$body" in
        *'"ready":false'*)
          zfails=$((zfails + 1))
          if [ "$zfails" -ge 2 ] && [ "$zwas" = ok ]; then
            notify "The portal at $url is up but cannot read Zabbix (checked twice, a minute apart)." && zwas=bad
          fi
          ;;
        *)
          zfails=0
          if [ "$zwas" = bad ]; then notify "The portal at $url can read Zabbix again." && zwas=ok; fi
          ;;
      esac
    fi
    put "$key.zabbix" "$zwas"
    put "$key.zfails" "$zfails"
  done

  [ -z "$CONTAINERS" ] && return
  if ! limited docker info; then
    docker_down
    return
  fi
  # Every container is read before anything is said about Docker: a read that hangs means Docker is not answering,
  # and "answers again" must not be said on the strength of `docker info` alone.
  reads=''
  for c in $CONTAINERS; do
    # The state first: a stopped container keeps the health status it had, which would read as healthy.
    limited docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.RestartCount}}' "$c"
    code=$?
    if [ "$code" -eq 124 ]; then
      docker_down
      return
    fi
    [ "$code" -eq 0 ] || LIMITED_OUT="missing none 0"
    reads="$reads$c $(printf '%s' "$LIMITED_OUT" | head -n 1)"$'\n'
  done
  told=$(get docker up)
  [ "$told" = down ] && { notify "Docker answers again." && told=up; }
  put docker "$told"
  put docker.bad 0
  while read -r c cstate chealth restarts; do
    [ -n "$c" ] || continue
    case $cstate in
      running) health=$chealth ;;
      *) health=$cstate ;;
    esac
    [ "$health" = none ] && health=running
    restarts=$(num "$restarts")
    before=$(num "$(get "$c.restarts" "$restarts")")
    if [ "$restarts" -ge $((before + 3)) ]; then
      # Not told: the count stays where it was, so the next check sees the same jump and says it again.
      notify "$c restarted $((restarts - before)) times since the last check: it is failing in a loop." || restarts=$before
    fi
    was=$(get "$c" healthy)
    bad=$(num "$(get "$c.bad" 0)")
    # What `was` holds is what was last told. Unhealthy has already waited out Docker's own retries, and a container that
    # is gone is rare, so those are told at once; stopped, paused, dead and created are the states a rebuild passes through.
    case $health in
      unhealthy | missing) broken=1 settle=1 ;;
      exited | dead | paused | created | restarting | removing) broken=1 settle=2 ;;
      *) broken=0 settle=0 ;;
    esac
    if [ "$broken" -eq 1 ]; then bad=$((bad + 1)); else bad=0; fi
    told=$was
    if [ "$broken" -eq 1 ]; then
      if [ "$bad" -ge "$settle" ] && [ "$health" != "$was" ]; then
        notify "$c is $health." && told=$health
      fi
    elif [ "$health" = healthy ] && [ "$was" != healthy ]; then
      notify "$c is healthy again." && told=healthy
    fi
    put "$c" "$told"
    put "$c.bad" "$bad"
    put "$c.restarts" "$restarts"
  done <<EOF
$reads
EOF
}

case "${1:-}" in
  --once)
    trap 'cleanup; exit 143' TERM INT HUP
    trap cleanup EXIT
    mkdir -p "$STATE_DIR" 2>/dev/null
    if ! take_lock; then
      log "another run is under way, so this one stops"
      exit 0
    fi
    check
    # Written beside the state and moved over it, so a run that reads it at the same moment sees the old file or the new one,
    # never half; each run has a file of its own, so two that overlap cannot tread on each other.
    NEWSTATE=$(mktemp "$STATE.XXXXXX" 2>/dev/null) || {
      NEWSTATE=''
      echo "watch.sh: cannot write its state in $STATE_DIR" >&2
      exit 1
    }
    printf '%s' "$NEXT" >"$NEWSTATE" && mv -f "$NEWSTATE" "$STATE" || {
      rm -f "$NEWSTATE"
      NEWSTATE=''
      echo "watch.sh: cannot write its state in $STATE_DIR" >&2
      exit 1
    }
    NEWSTATE=''
    # The time of this run, for whatever checks from outside that the watcher is still running.
    date +%s >"$HEARTBEAT" 2>/dev/null || true
    ;;
  --status)
    printf 'State (%s):\n' "$STATE"
    cat "$STATE" 2>/dev/null || echo '  none yet'
    printf '\nLast lines of %s:\n' "$LOG"
    tail -n 10 "$LOG" 2>/dev/null || echo '  none yet'
    # Not num: a time in seconds has ten digits, and num reads no more than nine.
    beat=$(head -n 1 "$HEARTBEAT" 2>/dev/null)
    case $beat in '' | *[!0-9]*) beat=0 ;; esac
    if [ "$beat" -eq 0 ]; then
      printf '\nLast run: never\n'
      exit 1
    fi
    age=$(($(date +%s) - beat))
    printf '\nLast run: %s s ago\n' "$age"
    if [ "$age" -gt 300 ]; then
      printf 'STALE: the watcher last ran %s s ago, and it should run every minute\n' "$age"
      exit 1
    fi
    ;;
  --install)
    [ "$(uname)" = Darwin ] || {
      echo "On Linux, run '$SELF --once' every minute from a systemd timer or cron; see docs/operations/after-a-restart.md." >&2
      exit 1
    }
    mkdir -p "$(dirname "$PLIST")" "$STATE_DIR"
    cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$SELF</string><string>--once</string></array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:$HOME/.docker/bin:/usr/bin:/bin</string></dict>
  <key>StandardErrorPath</key><string>$STATE_DIR/launchd.err</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Installed: $PLIST, every 60 s. Log: $LOG. Remove with: $SELF --uninstall"
    ;;
  --uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    rm -f "$PLIST"
    echo "Removed $LABEL. The state and the log stay in $STATE_DIR."
    ;;
  *)
    sed -n '2,/^set -u/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
