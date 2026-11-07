#!/usr/bin/env bash
# Weekly security sweep for one Linux (Ubuntu) machine.
#
#   sweep.sh [--dry-run|--apply] [--no-inbox] [--skip os,repos,docker,globals]
#
# What it changes (only with --apply, the default for the timer):
#   Ubuntu security-pocket updates, via unattended-upgrades, minus every package whose install
#   would restart or start a running service or container. needrestart is forced to list-only.
# Everything else is read-only and reported: code repos (osv-scanner), images of running
# containers (trivy), global CLIs (osv-scanner), pending reboots and service restarts.
# It never restarts a service, never touches a container, never reboots.
set -uo pipefail
umask 077

SWEEP_HOME="${SWEEP_HOME:-$(cd "$(dirname "$(readlink -f "$0")")" && pwd)}"
ENV_FILE="${SWEEP_ENV_FILE:-$SWEEP_HOME/security-sweep.env}"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

MODE="${SWEEP_MODE:-apply}"
WRITE_INBOX="${SWEEP_WRITE_INBOX:-1}"
SKIP=",${SWEEP_SKIP:-},"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) MODE=dry-run ;;
    --apply) MODE=apply ;;
    --no-inbox) WRITE_INBOX=0 ;;
    --skip) SKIP="$SKIP$2,"; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

# ---- settings (override in security-sweep.env) ----
SWEEP_REPO_ROOTS="${SWEEP_REPO_ROOTS:-/root /home/* /srv}"
SWEEP_REPO_PRUNE="${SWEEP_REPO_PRUNE:-node_modules .cache vendor .npm .bun .cargo .rustup .nvm .pyenv .local snap .Trash}"
SWEEP_OSV_EXCLUDE="${SWEEP_OSV_EXCLUDE:-node_modules vendor .cache fixtures testdata}"
SWEEP_INBOX_DIRS="${SWEEP_INBOX_DIRS:-/root/.claude/decision-inbox}"
SWEEP_SCRATCH_BASE="${SWEEP_SCRATCH_BASE:-/dev/shm}"
SWEEP_MIN_FREE_MB="${SWEEP_MIN_FREE_MB:-2048}"
SWEEP_MIN_MEM_MB="${SWEEP_MIN_MEM_MB:-8192}"
SWEEP_JAVA_DB="${SWEEP_JAVA_DB:-auto}"
SWEEP_KEEP_RUNS="${SWEEP_KEEP_RUNS:-4}"
SWEEP_HOST_LABEL="${SWEEP_HOST_LABEL:-$(hostname -s)}"
SWEEP_KEV_URL="${SWEEP_KEV_URL:-https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json}"
export SWEEP_HOLD_EXTRA="${SWEEP_HOLD_EXTRA:-}"

BIN="$SWEEP_HOME/bin"; LIB="$SWEEP_HOME/lib"
STATE="$SWEEP_HOME/state"; REPORTS="$SWEEP_HOME/reports"; RUNS="$SWEEP_HOME/runs"
mkdir -p "$STATE" "$REPORTS" "$RUNS"
export PATH="$BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
PY="python3 -I"

exec 9>"$STATE/sweep.lock"
flock -n 9 || { echo "another sweep is running" >&2; exit 3; }

DATE=$(date +%F); RUN_ID=$(date +%Y%m%d-%H%M%S)
log() { echo "[$(date +%T)] $*"; }
free_mb() { df -Pm "$1" | awk 'NR==2 {print $4}'; }
mem_mb() { awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo; }
skipped() { case "$SKIP" in *",$1,"*) return 0 ;; esac; return 1; }

SCRATCH=$(mktemp -d "$SWEEP_SCRATCH_BASE/security-sweep.XXXXXX") || { echo "cannot create scratch dir" >&2; exit 4; }
cleanup() { rm -rf --one-file-system "$SCRATCH"; }
trap cleanup EXIT
trap 'exit 130' INT TERM
RAW="$SCRATCH/raw"; mkdir -p "$RAW" "$SCRATCH/tmp"
export TMPDIR="$SCRATCH/tmp" XDG_CACHE_HOME="$SCRATCH/xdg-cache"
ERRS="$RAW/errors.txt"; : > "$ERRS"
fail() { log "PROBLEM [$1] $2"; printf '%s\t%s\n' "$1" "$2" >> "$ERRS"; }

log "security sweep $RUN_ID mode=$MODE host=$SWEEP_HOST_LABEL scratch=$SCRATCH"
log "disk free: $(free_mb /) MB on /, $(free_mb "$SWEEP_HOME") MB at $SWEEP_HOME; memory available: $(mem_mb) MB"

cat > "$RAW/meta.json" <<EOF
{"run_id": "$RUN_ID", "date": "$DATE", "mode": "$MODE", "host": "$SWEEP_HOST_LABEL",
 "started": "$(date -Is)", "disk_free_mb": $(free_mb /), "disk_use_pct": "$(df -P / | awk 'NR==2{print $5}')",
 "mem_avail_mb": $(mem_mb), "min_free_mb": $SWEEP_MIN_FREE_MB, "kernel": "$(uname -r)",
 "trivy": "$(trivy --version 2>/dev/null | awk '/^Version/{print $2; exit}')",
 "osv_scanner": "$(osv-scanner --version 2>/dev/null | awk '/version/{print $NF; exit}')",
 "home": "$SWEEP_HOME"}
EOF

# ---------- known-exploited list (CISA KEV), used to mark entries as urgent ----------
curl -fsS --max-time 60 -o "$RAW/kev.json" "$SWEEP_KEV_URL" || { fail kev "could not download the CISA known-exploited list"; echo '{}' > "$RAW/kev.json"; }

# ---------- trivy vulnerability DB, kept in RAM-backed scratch so it never fills the disk ----------
TRIVY_CACHE="$SCRATCH/trivy-cache"
TRIVY_OK=0
trivy_common=(--cache-dir "$TRIVY_CACHE" --quiet --no-progress --skip-version-check --skip-db-update --skip-java-db-update)
if command -v trivy >/dev/null; then
  if [ "$(mem_mb)" -lt "$SWEEP_MIN_MEM_MB" ]; then
    fail trivy "only $(mem_mb) MB memory available (need $SWEEP_MIN_MEM_MB); skipped image and host vulnerability scans"
  elif trivy image --download-db-only --cache-dir "$TRIVY_CACHE" --quiet --no-progress --skip-version-check; then
    TRIVY_OK=1
    if [ "$SWEEP_JAVA_DB" = 1 ] || { [ "$SWEEP_JAVA_DB" = auto ] && [ "$(mem_mb)" -gt $((SWEEP_MIN_MEM_MB + 4096)) ]; }; then
      trivy image --download-java-db-only --cache-dir "$TRIVY_CACHE" --quiet --no-progress --skip-version-check \
        || fail trivy "Java vulnerability DB download failed; Java libraries inside images were not checked"
    else
      log "trivy: Java DB skipped (SWEEP_JAVA_DB=$SWEEP_JAVA_DB)"
    fi
  else
    fail trivy "vulnerability DB download failed; image and host scans skipped"
  fi
else
  fail trivy "trivy is not installed (run install-tools.sh)"
fi

# =====================================================================================
# 1. OS packages
# =====================================================================================
stage_os() {
  log "os: refreshing package lists"
  apt-get -q -o DPkg::Lock::Timeout=900 update > "$RAW/apt-update.log" 2>&1 || fail os "apt-get update failed (see run log)"

  $PY "$LIB/apt_security.py" > "$RAW/apt.json" 2> "$RAW/apt.err" || { fail os "could not list pending updates: $(tail -1 "$RAW/apt.err")"; return; }
  local n_sec n_held
  n_sec=$(jq '.security | length' "$RAW/apt.json"); n_held=$(jq '[.security[] | select(.held)] | length' "$RAW/apt.json")
  log "os: $n_sec pending security updates, $n_held held back, $(jq '.other | length' "$RAW/apt.json") other updates (not applied)"

  # host package vulnerabilities, for severity: scan a copy of the package database only
  if [ "$TRIVY_OK" = 1 ]; then
    local h="$SCRATCH/hostroot"
    mkdir -p "$h/etc" "$h/usr/lib" "$h/var/lib/dpkg"
    cp /etc/os-release "$h/etc/" 2>/dev/null; cp /etc/lsb-release "$h/etc/" 2>/dev/null; cp /usr/lib/os-release "$h/usr/lib/" 2>/dev/null
    cp /var/lib/dpkg/status "$h/var/lib/dpkg/status"
    nice -n 10 trivy rootfs "${trivy_common[@]}" --scanners vuln --pkg-types os --severity HIGH,CRITICAL --ignore-unfixed \
      --format json -o "$RAW/host-trivy.json" "$h" 2> "$RAW/host-trivy.err" || fail os "host package vulnerability scan failed"
  fi

  # needrestart must be list-only, or an apt run could restart services
  local nr_mode
  nr_mode=$(perl -e 'our %nrconf; do "/etc/needrestart/needrestart.conf"; print $nrconf{restart} // "unset"' 2>/dev/null || echo unknown)
  echo "$nr_mode" > "$RAW/needrestart-mode.txt"

  # unattended-upgrades restricted to the security pocket, with the held packages blacklisted.
  # Uses a private copy of /etc/apt/apt.conf.d (minus the stock unattended-upgrades files);
  # /etc/apt itself is not modified. Package downloads go to the RAM scratch dir.
  local ac="$SCRATCH/aptconf"
  mkdir -p "$ac/parts" "$SCRATCH/apt-archives/partial"
  # let apt's unprivileged download user (_apt) write there, so downloads stay sandboxed
  if id _apt >/dev/null 2>&1; then
    chmod 711 "$SCRATCH"; chmod 755 "$SCRATCH/apt-archives"; chown _apt:root "$SCRATCH/apt-archives/partial"
  fi
  for f in /etc/apt/apt.conf.d/*; do
    case "$(basename "$f")" in *unattended-upgrade*|*auto-upgrades*) ;; *) cp "$f" "$ac/parts/" ;; esac
  done
  {
    echo '#clear Unattended-Upgrade::Allowed-Origins;'
    echo '#clear Unattended-Upgrade::Origins-Pattern;'
    echo '#clear Unattended-Upgrade::Package-Blacklist;'
    echo '#clear Unattended-Upgrade::Package-Whitelist;'
    echo 'Unattended-Upgrade::Allowed-Origins {'
    echo '  "${distro_id}:${distro_codename}-security";'
    echo '  "${distro_id}ESMApps:${distro_codename}-apps-security";'
    echo '  "${distro_id}ESM:${distro_codename}-infra-security";'
    echo '};'
    echo 'Unattended-Upgrade::Package-Blacklist {'
    jq -r '.security[] | select(.held) | .name' "$RAW/apt.json" | sed 's/[.+]/\\&/g; s/.*/  "^&$";/'
    for p in $SWEEP_HOLD_EXTRA; do printf '  "%s";\n' "$p"; done
    echo '};'
    echo 'Unattended-Upgrade::Automatic-Reboot "false";'
    echo 'Unattended-Upgrade::Remove-Unused-Dependencies "false";'
    echo 'Unattended-Upgrade::Remove-New-Unused-Dependencies "false";'
    echo 'Unattended-Upgrade::Remove-Unused-Kernel-Packages "false";'
    echo 'Unattended-Upgrade::Allow-downgrade "false";'
    echo 'Unattended-Upgrade::Mail "";'
    echo "Dir::Cache::archives \"$SCRATCH/apt-archives/\";"
  } > "$ac/parts/99security-sweep"
  printf 'Dir::Etc::Parts "%s/parts/";\n' "$ac" > "$ac/apt.conf"
  APT_CONFIG="$ac/apt.conf" apt-config dump > "$RAW/apt-config.txt" 2>&1

  local n_apply
  n_apply=$(jq '[.security[] | select(.held | not)] | length' "$RAW/apt.json")
  local uu_args=(-v)
  local why=""
  if [ "$MODE" != apply ]; then
    uu_args+=(--dry-run); why="dry run"
  elif [ "$nr_mode" != l ]; then
    uu_args+=(--dry-run); why="needrestart is not in list-only mode"
    fail os "needrestart restart mode is '$nr_mode', not 'l'; security updates were NOT applied"
  elif [ "$(free_mb /)" -lt "$SWEEP_MIN_FREE_MB" ]; then
    uu_args+=(--dry-run); why="low disk"
    fail os "only $(free_mb /) MB free on / (need $SWEEP_MIN_FREE_MB); security updates were NOT applied"
  fi
  echo "${why:-applied}" > "$RAW/uu-mode.txt"
  if [ "$n_apply" -gt 0 ]; then
    log "os: unattended-upgrade ${why:+(simulated: $why) }for $n_apply package(s)"
    APT_CONFIG="$ac/apt.conf" nice -n 10 unattended-upgrade "${uu_args[@]}" > "$RAW/uu.log" 2>&1 || fail os "unattended-upgrade exited with an error (see run log)"
  else
    echo "nothing to apply" > "$RAW/uu.log"
  fi

  # after: what still needs a reboot or restarts (report only, never acted on)
  if [ -f /var/run/reboot-required ]; then
    { echo "required"; sort -u /var/run/reboot-required.pkgs 2>/dev/null; } > "$RAW/reboot.txt"
  else
    echo "not-required" > "$RAW/reboot.txt"
  fi
  needrestart -b -r l > "$RAW/needrestart.txt" 2>&1 || true

  # is the stock daily auto-install on, and has it restarted services lately?
  {
    echo "periodic_unattended=$(apt-config shell X APT::Periodic::Unattended-Upgrade | sed -n "s/^X='\(.*\)'$/\1/p")"
    for f in /var/log/unattended-upgrades/unattended-upgrades-dpkg.log /var/log/unattended-upgrades/unattended-upgrades-dpkg.log.1; do
      [ -f "$f" ] && awk '/^Log started:/ {d=$3} /^Restarting services/ {r=1; next} /^Service restarts being deferred|^No services|^$/ {r=0} r && /systemctl restart/ {sub(/^ *systemctl restart /,""); print "restarted " d " " $0}' "$f"
    done
  } > "$RAW/daily.txt"
}

# =====================================================================================
# 2. Code repositories (lockfiles), read-only
# =====================================================================================
stage_repos() {
  command -v osv-scanner >/dev/null || { fail repos "osv-scanner is not installed (run install-tools.sh)"; return; }
  local prune=() first=1 p
  for p in $SWEEP_REPO_PRUNE; do
    [ $first = 1 ] && first=0 || prune+=(-o)
    prune+=(-name "$p")
  done
  # shellcheck disable=SC2086
  find $SWEEP_REPO_ROOTS -xdev \( -type d \( "${prune[@]}" \) -prune \) -o \( -name .git -print -prune \) 2>/dev/null \
    | sed 's#/\.git$##' | sort -u > "$RAW/repos.txt"
  log "repos: $(wc -l < "$RAW/repos.txt") git repos found"
  # group worktrees/clones of one repo by their shared git dir (read-only git call)
  while IFS= read -r r; do
    printf '%s\t%s\n' "$r" "$(git -c safe.directory='*' -C "$r" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "$r")"
  done < "$RAW/repos.txt" > "$RAW/repo-groups.tsv"

  local ex=() e
  for e in $SWEEP_OSV_EXCLUDE; do ex+=(--x-exclude "$e"); done
  mkdir -p "$RAW/osv-repos"
  split -l 40 -d -a 3 "$RAW/repos.txt" "$SCRATCH/repochunk."
  local c rc n=0 bad=0
  for c in "$SCRATCH"/repochunk.*; do
    [ -e "$c" ] || continue
    n=$((n + 1))
    local paths=()
    mapfile -t paths < "$c"
    (cd "$SCRATCH" && nice -n 10 osv-scanner scan source -r --no-resolve --format json \
      --output-file "$RAW/osv-repos/$(basename "$c").json" --verbosity error "${ex[@]}" -- "${paths[@]}") > /dev/null 2>> "$RAW/osv-repos.err"
    rc=$?
    # osv-scanner: 0 = clean, 1 = vulnerabilities found, 128 = no lockfiles in this batch; anything else failed
    case $rc in 0|1|128) ;; *) bad=$((bad + 1)); echo "batch $(basename "$c") exit $rc" >> "$RAW/osv-repos.err" ;; esac
  done
  [ $bad -gt 0 ] && fail repos "$bad of $n osv-scanner batches produced no result"
  log "repos: scanned in $n batches"
}

# =====================================================================================
# 3. Images of running containers, read-only
# =====================================================================================
stage_docker() {
  command -v docker >/dev/null || { log "docker: not installed"; return; }
  [ "$TRIVY_OK" = 1 ] || { fail docker "trivy unavailable; images not scanned"; return; }
  local ids
  ids=$(docker ps --no-trunc -q 2>/dev/null) || { fail docker "cannot talk to the docker daemon"; return; }
  [ -n "$ids" ] || { echo '[]' > "$RAW/containers.json"; log "docker: no running containers"; return; }
  # shellcheck disable=SC2086
  docker inspect $ids | jq '[.[] | {id: .Id[0:12], name: (.Name | ltrimstr("/")), image_id: .Image, image: .Config.Image,
      state: .State.Status, restarting: .State.Restarting,
      project: (.Config.Labels["com.docker.compose.project"] // ""), service: (.Config.Labels["com.docker.compose.service"] // ""),
      workdir: (.Config.Labels["com.docker.compose.project.working_dir"] // "")}]' > "$RAW/containers.json"
  mkdir -p "$RAW/trivy-images"
  local img size_mb n=0
  for img in $(jq -r '.[].image_id' "$RAW/containers.json" | sort -u); do
    n=$((n + 1))
    local label out digest
    label="${img:7:12} ($(jq -r --arg i "$img" '[.[] | select(.image_id == $i) | .image][0]' "$RAW/containers.json"))"
    out="$RAW/trivy-images/${img#sha256:}.json"
    if ! size_mb=$(docker image inspect --format '{{.Size}}' "$img" 2>/dev/null | awk '{print int($1/1048576)}') || [ -z "$size_mb" ]; then
      # the container still references an image that was deleted; nothing local to scan
      echo "$img" >> "$RAW/images-missing.txt"; log "docker: image $label no longer exists locally; not scanned"; continue
    fi
    if [ "$(mem_mb)" -lt "$SWEEP_MIN_MEM_MB" ]; then
      fail docker "skipped image $label: only $(mem_mb) MB memory available"; continue
    fi
    log "docker: scanning image ${img:7:12} (${size_mb} MB)"
    if ! nice -n 10 trivy image "${trivy_common[@]}" --image-src docker --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed \
        --timeout 30m --format json -o "$out" "$img" 2>> "$RAW/trivy-images.err"; then
      # local layer data can be incomplete (containerd image store); scan the identical image from its
      # registry by digest instead, when it has one
      rm -f "$out"
      digest=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$img" 2>/dev/null | head -1)
      if [ -n "$digest" ] && nice -n 10 trivy image "${trivy_common[@]}" --image-src remote --scanners vuln --severity HIGH,CRITICAL \
          --ignore-unfixed --timeout 30m --format json -o "$out" "$digest" 2>> "$RAW/trivy-images.err"; then
        log "docker: image ${img:7:12} scanned from its registry by digest (local layers incomplete)"
      else
        rm -f "$out"; fail docker "scan failed for image $label"
      fi
    fi
    rm -rf "${TMPDIR:?}"/* 2>/dev/null
  done
  log "docker: $n unique images from $(jq length "$RAW/containers.json") containers"
}

# =====================================================================================
# 4. Global CLIs, read-only
# =====================================================================================
stage_globals() {
  command -v osv-scanner >/dev/null || { fail globals "osv-scanner is not installed"; return; }
  local g="$SCRATCH/globals"
  mkdir -p "$g" "$RAW/osv-globals"
  $PY "$LIB/globals.py" "$g" > "$RAW/globals.json" 2> "$RAW/globals.err" || { fail globals "inventory failed: $(tail -1 "$RAW/globals.err")"; return; }
  local l name
  for l in "$g"/npm-global/package-lock.json "$g"/pip-global/requirements.txt "$g"/bun-global-*/bun.lock; do
    [ -s "$l" ] || continue
    name=$(basename "$(dirname "$l")")
    (cd "$g" && osv-scanner scan source -L "$l" --format json --output-file "$RAW/osv-globals/$name.json" --verbosity error) > /dev/null 2>> "$RAW/osv-globals.err"
    [ -s "$RAW/osv-globals/$name.json" ] || fail globals "osv-scanner failed for $name"
    cp "$l" "$RAW/osv-globals/$name.lock" 2>/dev/null
  done
}

skipped os || stage_os
skipped repos || stage_repos
skipped docker || stage_docker
skipped globals || stage_globals

# =====================================================================================
# 5. Report + decision-inbox entries
# =====================================================================================
REPORT="$REPORTS/$DATE.md"
[ "$MODE" = apply ] || REPORT="$REPORTS/$DATE-dry-run.md"
inbox_args=()
[ "$WRITE_INBOX" = 1 ] && for d in $SWEEP_INBOX_DIRS; do inbox_args+=(--inbox "$d"); done
$PY "$LIB/report.py" --raw "$RAW" --report "$REPORT" --state "$STATE/inbox-state.json" "${inbox_args[@]}" \
  || { log "report generation failed"; printf '# Security sweep %s\n\nReport generation failed; see `journalctl -u security-sweep`.\n' "$DATE" > "$REPORT"; }
log "report: $REPORT"

# keep a compressed copy of the raw results for a few runs
tar -C "$SCRATCH" -czf "$RUNS/$RUN_ID.tar.gz" raw 2>/dev/null || true
ls -1t "$RUNS"/*.tar.gz 2>/dev/null | tail -n +"$((SWEEP_KEEP_RUNS + 1))" | xargs -r rm -f
log "done; disk free: $(free_mb /) MB"
