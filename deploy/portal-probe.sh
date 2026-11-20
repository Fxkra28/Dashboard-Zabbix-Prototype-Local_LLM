#!/usr/bin/env bash
# One value a call, for HCML's Zabbix agent to read as a UserParameter (deploy/zabbix/hcml-portal.conf): whether the portal answers, whether it says its Zabbix answers, the days left on its certificate, and the
# graphics card's temperature and memory. It reads and changes nothing. A value it cannot read is printed as ZBX_NOTSUPPORTED, which Zabbix shows as an item that is not supported.
#
#   deploy/portal-probe.sh health              1 when the portal answers 200 and says "ok":true, else 0
#   deploy/portal-probe.sh zabbix              1 when the portal says that its own Zabbix answers ("ready":true), else 0
#   deploy/portal-probe.sh cert-days HOST [PORT]   whole days until the certificate that HOST:PORT (default 443) shows ends; negative when it has ended
#   deploy/portal-probe.sh gpu-temp            the first card's temperature, in degrees
#   deploy/portal-probe.sh gpu-mem-pct         the first card's memory in use, in percent
#   deploy/portal-probe.sh ollama              1 when the model server answers its list of models, else 0 (OLLAMA_URL, default http://127.0.0.1:11434, the loopback port of docker-compose.vm.yml)
#   deploy/portal-probe.sh backup-age [DIR]    whole hours since the newest backup file in DIR (default /var/backups/hcml); not supported when there is none
#
# PORTAL_URL is where the portal answers from this machine (default http://127.0.0.1:8082, the port that the web container of hcml-portal-ollama is published on; hcml-portal uses 8081). The days are counted from now to the certificate's notAfter.
# Every call stops itself after two seconds, below the three that a Zabbix agent waits by default (its Timeout, 1 to 30): a portal that accepts the connection and never answers would otherwise leave the item unsupported instead of 0.
set -u
export LC_ALL=C

URL="${PORTAL_URL:-http://127.0.0.1:8082}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
# Two seconds, curl's own limit and, where the machine has timeout, the command's: a stand-in that ignores its arguments is stopped too.
LIMIT=2
limited() {
  if command -v timeout >/dev/null 2>&1; then timeout "$LIMIT" "$@"; else "$@"; fi
}
nope() {
  printf 'ZBX_NOTSUPPORTED\n'
  [ $# -gt 0 ] && printf 'portal-probe.sh: %s\n' "$*" >&2
  exit 0
}
have() { command -v "$1" >/dev/null 2>&1; }

health_body() { limited curl -s --max-time "$LIMIT" -w '\n%{http_code}' "$URL/bff/api/health" 2>/dev/null; }

# A certificate's end as Unix seconds: GNU date reads the text of openssl directly, BSD date needs the format.
epoch_of() {
  date -u -d "$1" +%s 2>/dev/null && return 0
  date -u -j -f '%b %e %T %Y %Z' "$1" +%s 2>/dev/null
}

case "${1:-}" in
  health)
    have curl || nope "curl is not here"
    out="$(health_body)"
    code="$(printf '%s' "$out" | tail -n 1)"
    if [ "$code" = "200" ] && printf '%s' "$out" | grep -q '"ok":true'; then echo 1; else echo 0; fi
    ;;
  zabbix)
    have curl || nope "curl is not here"
    out="$(health_body)"
    if printf '%s' "$out" | grep -q '"ready":true'; then echo 1; else echo 0; fi
    ;;
  cert-days)
    host="${2:-}"
    port="${3:-443}"
    [ -n "$host" ] || nope "cert-days needs a host name"
    have openssl || nope "openssl is not here"
    end="$(printf '' | limited openssl s_client -servername "$host" -connect "$host:$port" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | sed 's/^notAfter=//')"
    [ -n "$end" ] || nope "no certificate was shown by $host:$port"
    at="$(epoch_of "$end")" || nope "could not read the date $end"
    now="$(date -u +%s)"
    # Floor toward minus infinity, so that a certificate that ended an hour ago is -1 and not 0.
    diff=$((at - now))
    if [ "$diff" -ge 0 ]; then echo $((diff / 86400)); else echo $(((diff - 86399) / 86400)); fi
    ;;
  ollama)
    have curl || nope "curl is not here"
    code="$(limited curl -s --max-time "$LIMIT" -o /dev/null -w '%{http_code}' "$OLLAMA_URL/api/tags" 2>/dev/null)"
    if [ "$code" = "200" ]; then echo 1; else echo 0; fi
    ;;
  backup-age)
    dir="${2:-/var/backups/hcml}"
    [ -d "$dir" ] || nope "$dir is not a folder"
    # backup-state.sh makes its folder for its own user (mode 700), and the agent is another user: say so, and not that there is no backup.
    { [ -r "$dir" ] && [ -x "$dir" ]; } || nope "$dir cannot be read by the user the agent runs as: give the folder to the agent's group, mode 750 (docs/operations/vm-runbook.md, step 7)"
    newest="$(ls -t "$dir"/*.tar.gz.enc 2>/dev/null | head -n 1)"
    [ -n "$newest" ] || nope "no backup file in $dir"
    # The file's own time: GNU stat says -c %Y, BSD stat says -f %m.
    now="$(date -u +%s)"
    then="$(stat -c %Y "$newest" 2>/dev/null || stat -f %m "$newest" 2>/dev/null)"
    case "$then" in '' | *[!0-9]*) nope "could not read the age of $newest" ;; esac
    age=$((now - then))
    [ "$age" -ge 0 ] || age=0
    echo $((age / 3600))
    ;;
  gpu-temp)
    have nvidia-smi || nope "nvidia-smi is not here"
    v="$(limited nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits 2>/dev/null | head -n 1 | tr -d ' ')"
    case "$v" in '' | *[!0-9]*) nope "no card was read" ;; *) echo "$v" ;; esac
    ;;
  gpu-mem-pct)
    have nvidia-smi || nope "nvidia-smi is not here"
    line="$(limited nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | head -n 1)"
    used="$(printf '%s' "$line" | cut -d, -f1 | tr -d ' ')"
    total="$(printf '%s' "$line" | cut -d, -f2 | tr -d ' ')"
    case "$used$total" in '' | *[!0-9]*) nope "no card was read" ;; esac
    [ "$total" -gt 0 ] || nope "the card reports no memory"
    echo $((used * 100 / total))
    ;;
  -h | --help | '')
    sed -n '2,/^set -u/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
    ;;
  *)
    nope "unknown probe ${1}"
    ;;
esac
