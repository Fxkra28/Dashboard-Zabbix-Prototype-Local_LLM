#!/usr/bin/env bash
# What this machine can do for the local model, read from the machine itself (the gate of docs/operations/vm-runbook.md, step 0).
# It changes nothing and sends nothing but one request to the model registry, which asks whether the registry answers. One line a check; it ends with 0 when no check failed.
#
#   deploy/gpu-gate.sh
#
# The limits below are our own estimates, from the size of the model files plus the cache of an 8,192-token context. deploy/model-speed.py is the measure that counts.
set -u
export LC_ALL=C

FAILS=0
WARNS=0
say() { printf '  %-5s %-10s %s\n' "$1" "$2" "$3"; }
ok() { say OK "$1" "$2"; }
warn() { WARNS=$((WARNS + 1)); say WARN "$1" "$2"; }
fail() { FAILS=$((FAILS + 1)); say FAIL "$1" "$2"; }
have() { command -v "$1" >/dev/null 2>&1; }

echo "gpu-gate: this machine, for the local model"

# The system: the portal's containers and Ollama's own image are Linux ones.
kernel="$(uname -s 2>/dev/null || echo unknown)"
arch="$(uname -m 2>/dev/null || echo unknown)"
if [ "$kernel" = "Linux" ]; then ok system "Linux $arch"; else fail system "$kernel $arch: run this on the machine that will host the portal"; fi

# The processor: how many cores, and whether it has AVX2, which Ollama's processor path wants on x86.
if have lscpu; then
  info="$(lscpu 2>/dev/null)"
  model="$(printf '%s\n' "$info" | awk -F: '/^Model name:/ {sub(/^[ \t]+/, "", $2); print $2; exit}')"
  cpus="$(printf '%s\n' "$info" | awk -F: '/^CPU\(s\):/ {gsub(/[ \t]/, "", $2); print $2; exit}')"
  if printf '%s\n' "$info" | grep -E '^Flags:' | grep -qw avx2; then avx="AVX2"; else avx=""; fi
  case "$arch" in
    x86_64) if [ -n "$avx" ]; then ok processor "$model, ${cpus:-?} CPUs, AVX2"; else NOAVX=1; warn processor "$model, ${cpus:-?} CPUs, no AVX2: the model must run on a card"; fi ;;
    *) ok processor "$model, ${cpus:-?} CPUs" ;;
  esac
else
  warn processor "lscpu is not here, so the processor was not read"
fi

# Memory: the portal holds 2 GB, the model's files are read through it, and the system needs its own.
if have free; then
  mem_mib="$(free -m 2>/dev/null | awk '/^Mem:/ {print $2}')"
  mem_mib="${mem_mib:-0}"
  mem_gib=$((mem_mib / 1024))
  if [ "$mem_mib" -ge 28000 ]; then ok memory "${mem_gib} GiB"
  elif [ "$mem_mib" -ge 16000 ]; then warn memory "${mem_gib} GiB: we advise 32 GB, so that the portal, the model's files and the system have room together"
  else fail memory "${mem_gib} GiB: less than the 16 GB the portal and a model need together"; fi
else
  warn memory "free is not here, so the memory was not read"
fi

# Docker, and the disk it keeps the images and the models on.
if have docker; then
  version="$(docker --version 2>/dev/null | sed -e 's/^Docker version //' -e 's/,.*//')"
  compose="$(docker compose version --short 2>/dev/null || true)"
  if [ -n "$compose" ]; then ok docker "$version, compose $compose"; else fail docker "$version, but not the compose plugin (docker compose)"; fi
  root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
else
  fail docker "docker is not installed"
  root=""
fi
[ -n "$root" ] && [ -d "$root" ] || root="/"
free_kib="$(df -Pk "$root" 2>/dev/null | awk 'NR==2 {print $4}')"
free_kib="${free_kib:-0}"
free_gib=$((free_kib / 1048576))
if [ "$free_gib" -ge 100 ]; then ok disk "${free_gib} GiB free under $root"
elif [ "$free_gib" -ge 60 ]; then warn disk "${free_gib} GiB free under $root: we advise 100 GB, for the images, up to three models and the logs"
else fail disk "${free_gib} GiB free under $root: the images and the models need 60 GB at the least"; fi

# The card, and whether Docker can hand it to a container.
CARD=0
if have nvidia-smi; then
  line="$(nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits 2>/dev/null | head -n 1)"
fi
if [ -n "${line:-}" ]; then
  CARD=1
  name="$(printf '%s' "$line" | awk -F, '{gsub(/^[ \t]+|[ \t]+$/, "", $1); print $1}')"
  vram="$(printf '%s' "$line" | awk -F, '{gsub(/[ \t]/, "", $2); print $2}')"
  driver="$(printf '%s' "$line" | awk -F, '{gsub(/[ \t]/, "", $3); print $3}')"
  vram="${vram:-0}"
  if [ "$vram" -ge 16000 ]; then ok card "$name, $vram MiB, driver $driver: room for the 8B, 9B and 12B models"
  elif [ "$vram" -ge 10000 ]; then warn card "$name, $vram MiB, driver $driver: room for the 8B and 9B models, not the 12B. We asked for 16 GB at the least, and the bake-off says whether a smaller model answers well enough"
  else CARD=0; fail card "$name, $vram MiB: too little for a 8B model with its cache; use a bigger card, or the processor"; fi
  if have docker && docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q nvidia; then ok runtime "Docker has the NVIDIA runtime"
  else fail runtime "Docker has no NVIDIA runtime: install the NVIDIA Container Toolkit and run: nvidia-ctk runtime configure --runtime=docker"; fi
else
  say NOTE card "no NVIDIA card was found by nvidia-smi"
fi

# The registry the models come from: the manifest of the model we start from, a few hundred bytes. The machine may have no way out, and then the models are brought in by hand.
if have curl; then
  code="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' https://registry.ollama.ai/v2/library/qwen3/manifests/8b 2>/dev/null || true)"
  if [ "$code" = 200 ]; then ok registry "registry.ollama.ai gives the manifest of a model"
  else warn registry "registry.ollama.ai gave $( [ "${code:-000}" = 000 ] && echo 'no answer' || echo "HTTP $code" ): ask HCML IT to allow it, or bring the models in by hand (docs/operations/vm-runbook.md)"; fi
else
  warn registry "curl is not here, so the registry was not tried"
fi

echo
if [ "$FAILS" -gt 0 ]; then
  echo "verdict: NO-GO. $FAILS check(s) failed; mend the lines marked FAIL, then run this again."
  exit 1
fi
# One line in the machine's .env gives every plain command, deploy/rebuild.sh and the restore the same files, so that none of them forgets the overlays (runbook step 5, IN-100).
# The Zabbix override is named only where the file is there: it is not in git and no step makes it, and a line that names a file that does not exist stops every Compose command.
case "$0" in */*) here="${0%/*}" ;; *) here=. ;; esac
ROOT="${GATE_ROOT:-$here/..}"
files="docker-compose.yml"
[ -f "$ROOT/docker-compose.override.yml" ] && files="$files:docker-compose.override.yml"
files="$files:docker-compose.vm.yml"
[ "$CARD" = 1 ] && files="$files:docker-compose.vm-gpu.yml"
if [ "$CARD" = 1 ]; then
  echo "verdict: GO with the card. Put this line in the .env of the copy, then start the stack from its folder with: docker compose up -d"
  echo "         COMPOSE_FILE=$files"
  echo "         then pull the model and run: python3 deploy/model-speed.py <model>"
else
  echo "verdict: PROCESSOR ONLY. Put this line in the .env of the copy, then start the stack from its folder with: docker compose up -d"
  echo "         COMPOSE_FILE=$files"
  echo "         then pull the model and run: python3 deploy/model-speed.py <model>. The Assistant stays off unless that says PASS (a cold first word within 30 s)."
fi
[ -f "$ROOT/docker-compose.override.yml" ] || echo "         There is no docker-compose.override.yml here, so the line leaves it out. If the portal reaches HCML's Zabbix by an address that has to be mapped (runbook step 5), make that file first and put it after docker-compose.yml in the line."

[ "${NOAVX:-0}" = 1 ] && [ "$CARD" != 1 ] && echo "         This processor has no AVX2, so expect FAIL: the model needs a card."
[ "$WARNS" -gt 0 ] && echo "         $WARNS warning(s) above are for HCML IT to read; they do not stop the start."
exit 0
