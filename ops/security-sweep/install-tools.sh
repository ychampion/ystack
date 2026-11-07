#!/usr/bin/env bash
# Download the scanner binaries the sweep uses, from their official GitHub releases,
# and verify each against the release's published SHA-256 checksum file.
# Installs into "$SWEEP_HOME/bin". Never pipes anything into a shell.
set -euo pipefail

SWEEP_HOME="${SWEEP_HOME:-$(cd "$(dirname "$(readlink -f "$0")")" && pwd)}"
ENV_FILE="${SWEEP_ENV_FILE:-$SWEEP_HOME/security-sweep.env}"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

# Pinned versions. Prefer a release that has been public for a couple of weeks.
TRIVY_VERSION="${TRIVY_VERSION:-0.76.1}"
OSV_SCANNER_VERSION="${OSV_SCANNER_VERSION:-2.7.0}"
SWEEP_MIN_FREE_MB="${SWEEP_MIN_FREE_MB:-2048}"

BIN="$SWEEP_HOME/bin"
DL="$SWEEP_HOME/downloads"
mkdir -p "$BIN" "$DL"

free_mb() { df -Pm "$1" | awk 'NR==2 {print $4}'; }
need=$(( SWEEP_MIN_FREE_MB + 300 ))
if [ "$(free_mb "$SWEEP_HOME")" -lt "$need" ]; then
  echo "install-tools: only $(free_mb "$SWEEP_HOME") MB free, need $need MB; not installing" >&2
  exit 2
fi

case "$(uname -m)" in
  x86_64) TRIVY_ARCH=Linux-64bit; OSV_ARCH=linux_amd64 ;;
  aarch64) TRIVY_ARCH=Linux-ARM64; OSV_ARCH=linux_arm64 ;;
  *) echo "install-tools: unsupported arch $(uname -m)" >&2; exit 2 ;;
esac

fetch() { curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$2" "$1"; }

# verify <checksum file> <file name in checksum file> <local path>
verify() {
  local want got
  want=$(awk -v f="$2" '$2 == f || $2 == "*"f {print $1}' "$1")
  [ -n "$want" ] || { echo "install-tools: $2 not listed in $1" >&2; return 1; }
  got=$(sha256sum "$3" | awk '{print $1}')
  [ "$want" = "$got" ] || { echo "install-tools: CHECKSUM MISMATCH for $2 (want $want got $got)" >&2; return 1; }
  echo "install-tools: sha256 OK  $2  $got"
}

install_trivy() {
  local v="$TRIVY_VERSION" d="$DL/trivy-$TRIVY_VERSION"
  if [ -x "$BIN/trivy" ] && "$BIN/trivy" --version 2>/dev/null | grep -q "Version: $v$"; then
    echo "install-tools: trivy $v already installed"; return 0
  fi
  rm -rf "$d"; mkdir -p "$d"
  local base="https://github.com/aquasecurity/trivy/releases/download/v$v"
  local tgz="trivy_${v}_${TRIVY_ARCH}.tar.gz"
  fetch "$base/trivy_${v}_checksums.txt" "$d/checksums.txt"
  fetch "$base/$tgz" "$d/$tgz"
  verify "$d/checksums.txt" "$tgz" "$d/$tgz"
  mkdir -p "$d/x"
  tar -xzf "$d/$tgz" -C "$d/x" --no-same-owner trivy
  install -m 0755 "$d/x/trivy" "$BIN/trivy"
  rm -rf "$d/x" "$d/$tgz"
  "$BIN/trivy" --version | head -1
}

install_osv() {
  local v="$OSV_SCANNER_VERSION" d="$DL/osv-scanner-$OSV_SCANNER_VERSION"
  if [ -x "$BIN/osv-scanner" ] && "$BIN/osv-scanner" --version 2>/dev/null | grep -q "version: $v$"; then
    echo "install-tools: osv-scanner $v already installed"; return 0
  fi
  rm -rf "$d"; mkdir -p "$d"
  local base="https://github.com/google/osv-scanner/releases/download/v$v"
  local f="osv-scanner_${OSV_ARCH}"
  fetch "$base/osv-scanner_SHA256SUMS" "$d/SHA256SUMS"
  fetch "$base/$f" "$d/$f"
  verify "$d/SHA256SUMS" "$f" "$d/$f"
  install -m 0755 "$d/$f" "$BIN/osv-scanner"
  rm -f "$d/$f"
  "$BIN/osv-scanner" --version | head -1
}

install_trivy
install_osv
echo "install-tools: done; $(free_mb "$SWEEP_HOME") MB free"
