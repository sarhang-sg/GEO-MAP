#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

REPO="sarhang-sg/GEO-MAP"
ZIP_NAME="NAV-KURD-v8.0.4-WEB.zip"
DOWNLOAD_DIR="/storage/emulated/0/Download"
ZIP_PATH="$DOWNLOAD_DIR/$ZIP_NAME"
TMP_BASE="${TMPDIR:-${PREFIX:-/data/data/com.termux/files/usr}/tmp}"
WORK_DIR="$(mktemp -d "$TMP_BASE/nav-kurd-runtime.XXXXXX")"

cleanup() {
  case "$WORK_DIR" in
    "$TMP_BASE"/nav-kurd-runtime.*) rm -rf -- "$WORK_DIR" ;;
  esac
}
trap cleanup EXIT

echo "1/7  Preparing Termux tools"
termux-setup-storage >/dev/null 2>&1 || true
pkg install -y git gh unzip rsync >/dev/null

test -f "$ZIP_PATH" || {
  echo "ERROR: $ZIP_PATH is missing" >&2
  exit 1
}

if test -f "$ZIP_PATH.sha256"; then
  (cd "$DOWNLOAD_DIR" && sha256sum -c "$ZIP_NAME.sha256")
else
  sha256sum "$ZIP_PATH"
fi

echo "2/7  Checking the final GitHub account"
if ! gh auth status -h github.com >/dev/null 2>&1; then
  gh auth login -h github.com -p https -w
fi
gh auth setup-git
ACCOUNT="$(gh api user --jq .login)"
test "$ACCOUNT" = "sarhang-sg" || {
  echo "ERROR: GitHub is logged in as $ACCOUNT, expected sarhang-sg" >&2
  exit 1
}

echo "3/7  Verifying the release source"
mkdir -p "$WORK_DIR/unpack"
unzip -q "$ZIP_PATH" -d "$WORK_DIR/unpack"
SOURCE_DIR="$WORK_DIR/unpack/GEO-MAP-WEB-8.0.4"
test -f "$SOURCE_DIR/package.json" || {
  echo "ERROR: GEO-MAP-WEB-8.0.4/package.json is missing from the ZIP" >&2
  exit 1
}
test -f "$SOURCE_DIR/supabase/migrations/20260828_000023_release_runtime_fixes.sql" || {
  echo "ERROR: runtime-fix migration 000023 is missing from the ZIP" >&2
  exit 1
}

echo "4/7  Overlaying the verified source on the current private repository"
gh repo view "$REPO" --json nameWithOwner,visibility \
  --jq '.nameWithOwner + " | " + .visibility'
gh repo clone "$REPO" "$WORK_DIR/repo"
git -C "$WORK_DIR/repo" switch main
git -C "$WORK_DIR/repo" pull --ff-only origin main
rsync -a --exclude='.git/' "$SOURCE_DIR/" "$WORK_DIR/repo/"

# This exact obsolete stylesheet was removed by the v8.0.4 runtime fix. No
# other repository path is deleted by this script.
git -C "$WORK_DIR/repo" rm -f --ignore-unmatch src/styles/ambient-weather.css

echo "5/7  Committing and pushing the web/runtime fixes"
git -C "$WORK_DIR/repo" add -A
if git -C "$WORK_DIR/repo" diff --cached --quiet; then
  echo "PASS: GitHub main already contains these runtime fixes"
else
  git -C "$WORK_DIR/repo" config user.name "$ACCOUNT"
  git -C "$WORK_DIR/repo" config user.email "$ACCOUNT@users.noreply.github.com"
  git -C "$WORK_DIR/repo" commit -m "Fix NAV KURD 8.0.4 mobile auth, moderation and map UI"
  git -C "$WORK_DIR/repo" push origin main
fi

echo "6/7  Deploying migration 000023 and current Edge Functions"
gh workflow run supabase-deploy.yml \
  --repo "$REPO" \
  --ref main \
  -f mode=all \
  -f confirm=DEPLOY \
  -f repair_legacy_history=false

sleep 3
RUN_ID="$(gh run list --repo "$REPO" --workflow supabase-deploy.yml --branch main \
  --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "$RUN_ID" || {
  echo "ERROR: The Supabase workflow run could not be found" >&2
  exit 1
}
gh run watch "$RUN_ID" --repo "$REPO" --exit-status

echo "7/7  Complete"
echo "PASS: GitHub source and Supabase runtime fixes are deployed."
echo "Vercel will redeploy automatically from the main-branch push."
echo "Open: https://vercel.com/dashboard"
