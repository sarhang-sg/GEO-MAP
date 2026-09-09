#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOWNLOADS="${NAV_KURD_DOWNLOADS:-/storage/emulated/0/Download}"
MAX_ATTEMPTS=12
TYPESCRIPT_VERSION="5.9.3"
cd "$ROOT"

log() { printf '\n[NAV KURD WEB] %s\n' "$*"; }
fail() { printf '\n[NAV KURD WEB] ERROR: %s\n' "$*" >&2; exit 1; }

retry() {
  local attempt=1
  while ! "$@"; do
    if (( attempt >= MAX_ATTEMPTS )); then
      fail "Command failed after ${MAX_ATTEMPTS} attempts: $*"
    fi
    log "Network attempt ${attempt}/${MAX_ATTEMPTS} failed; retrying"
    sleep $(( attempt < 6 ? attempt * 3 : 18 ))
    attempt=$((attempt + 1))
  done
}

require_toolchain() {
  command -v node >/dev/null 2>&1 || fail "Node.js is missing. Run: bash TERMUX.sh setup"
  command -v npm >/dev/null 2>&1 || fail "npm is missing. Run: bash TERMUX.sh setup"
  [[ "$(node -p 'process.versions.node.split(".")[0]')" == "24" ]] || fail "Node.js 24.x is required; found $(node --version)."
  [[ "$(npm --version | cut -d. -f1)" == "11" ]] || fail "npm 11.x is required; found $(npm --version)."
  [[ "$(node -p 'require("./package.json").devDependencies.typescript')" == "$TYPESCRIPT_VERSION" ]] ||
    fail "TypeScript $TYPESCRIPT_VERSION is required for Android/Termux compatibility."
  [[ "$(node -p 'require("./package-lock.json").packages["node_modules/typescript"].version')" == "$TYPESCRIPT_VERSION" ]] ||
    fail "package-lock.json does not match TypeScript $TYPESCRIPT_VERSION."
  node -e 'const p=require("./package-lock.json").packages; for (const n of ["node_modules/@rolldown/binding-android-arm64","node_modules/lightningcss-android-arm64"]) if (!p[n]) process.exit(1)' ||
    fail "package-lock.json is missing Android ARM64 build bindings."
}

setup() {
  command -v pkg >/dev/null 2>&1 || fail "Run this command inside Termux."
  termux-setup-storage >/dev/null 2>&1 || true
  retry pkg update -y
  retry pkg install -y nodejs-lts git python clang make pkg-config openssl-tool coreutils
  require_toolchain
  retry npm ci --no-audit --no-fund
  npm run verify:toolchain
  npm run typecheck
  log "Setup completed"
}

check() {
  require_toolchain
  retry npm ci --no-audit --no-fund
  npm run verify:toolchain
  npm run typecheck
  npm run data:prepare
  npm run verify:production
  retry npm audit --omit=dev --audit-level=high
}

build() {
  require_toolchain
  retry npm ci --no-audit --no-fund
  npm run build
  retry npm audit --omit=dev --audit-level=high
  log "Production output: ${ROOT}/dist"
}

package_source() {
  require_toolchain
  build
  mkdir -p "$DOWNLOADS"
  python3 tools/release/package-release.py \
    --output-dir "$DOWNLOADS" \
    --name NAV-KURD-9.1.0-WEB-UI-R16.zip \
    --root-name NAV-KURD-9.1.0-WEB
  log "Source ZIP and checksums saved in Android Download"
}

case "${1:-help}" in
  setup) setup ;;
  check) check ;;
  build) build ;;
  package) package_source ;;
  *)
    printf '%s\n' "Usage: bash TERMUX.sh setup|check|build|package"
    ;;
esac
