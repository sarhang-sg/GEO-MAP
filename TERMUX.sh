#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

log(){ printf '\n[NAV KURD] %s\n' "$*"; }
fail(){ printf '\n[NAV KURD] ERROR: %s\n' "$*" >&2; exit 1; }

require_toolchain(){
  command -v node >/dev/null || fail "Node.js is not installed. Run: bash TERMUX.sh setup"
  command -v npm >/dev/null || fail "npm is not installed. Run: bash TERMUX.sh setup"
  local node_major npm_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  npm_major="$(npm --version | cut -d. -f1)"
  [[ "$node_major" == "24" ]] || fail "Node.js 24.x is required; found $(node --version)."
  [[ "$npm_major" == "11" ]] || fail "npm 11.x is required; found $(npm --version)."
}

setup(){
  command -v pkg >/dev/null || fail "This setup command must run inside Termux."
  log "Updating Termux packages"
  pkg update -y
  pkg install -y nodejs-lts git python clang make pkg-config openssl-tool libjpeg-turbo libpng
  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "$node_major" == "24" ]] || fail "The current Termux repository did not provide Node.js 24. Update Termux from F-Droid/GitHub, run pkg update, then rerun setup. nvm binaries are intentionally not used because they are not reliable on Android/Termux."
  npm install --global npm@11
  require_toolchain
  log "Reconciling the package lock with pinned security overrides"
  npm install --package-lock-only --ignore-scripts --no-audit --no-fund
  log "Installing exact project dependencies"
  npm ci --no-audit --no-fund
  log "Verifying pinned security dependency versions"
  node tools/verify/dependency-security.mjs
  log "Setup complete"
}

check(){
  require_toolchain
  npm run data:prepare
  npm run verify:static
  npm run verify:release
}

verify(){
  require_toolchain
  npm run verify
}

build(){
  require_toolchain
  npm run build
  log "Production output: $ROOT/dist"
}

package_source(){
  require_toolchain
  npm run build
  python3 tools/release/package-release.py --output-dir "$HOME/storage/downloads"
}

push_repo(){
  require_toolchain
  local owner="${1:-}" repository="${2:-}" branch="${3:-main}"
  [[ -n "$owner" && -n "$repository" ]] || fail "Usage: bash TERMUX.sh push OWNER REPOSITORY [BRANCH]"
  npm run build
  git init
  git branch -M "$branch"
  git add -A
  git commit -m "NAV KURD 8.0.4 GPS, weather, widget and reliability release" || true
  local remote="https://github.com/${owner}/${repository}.git"
  if git remote get-url origin >/dev/null 2>&1; then git remote set-url origin "$remote"; else git remote add origin "$remote"; fi
  git push -u origin "$branch"
}

case "${1:-help}" in
  setup) setup ;;
  check) check ;;
  verify) verify ;;
  build) build ;;
  package) package_source ;;
  push) shift; push_repo "$@" ;;
  *) cat <<'HELP'
Usage: bash TERMUX.sh setup|check|verify|build|package|push
HELP
  ;;
esac
