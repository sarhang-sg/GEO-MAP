#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

readonly repo="sarhang-sg/GEO-MAP"
readonly download_dir="/storage/emulated/0/Download"
readonly archive_name="NAV-KURD-v9.0.0-WEB.zip"
readonly archive_path="$download_dir/$archive_name"
readonly expected_root="GEO-MAP-WEB-9.0.0"
temp_dir=""

cleanup() {
  if [[ -n "$temp_dir" && "$temp_dir" == "${TMPDIR:-${PREFIX:-/data/data/com.termux/files/usr}/tmp}"/nav-kurd-web-v9.* ]]; then
    rm -rf -- "$temp_dir"
  fi
}
trap cleanup EXIT

die() { echo "ERROR: $*" >&2; exit 1; }

retry() {
  local attempt=1
  local maximum=12
  until "$@"; do
    (( attempt >= maximum )) && return 1
    sleep $(( attempt < 5 ? attempt * 3 : 15 ))
    attempt=$((attempt + 1))
  done
}

echo "1/8 — Preparing the authenticated Web-first release..."
[[ -d "$download_dir" ]] || {
  termux-setup-storage
  die "Allow Android storage access, then run this script again."
}
missing=()
for command_name in git gh unzip rsync sha256sum node; do
  command -v "$command_name" >/dev/null 2>&1 || missing+=("$command_name")
done
if (( ${#missing[@]} )); then
  pkg update -y
  pkg install -y git gh unzip rsync coreutils nodejs-lts
fi
retry gh auth status -h github.com >/dev/null 2>&1 ||
  die "Run 'gh auth login', choose GitHub.com + HTTPS + browser, then rerun."
account="$(retry gh api user --jq .login)"
[[ "$account" == "sarhang-sg" ]] || die "GitHub is signed in as $account; expected sarhang-sg."

echo "2/8 — Verifying the v9 Web archive..."
[[ -s "$archive_path" ]] || die "$archive_path was not found."
[[ -s "$archive_path.sha256" ]] || die "$archive_path.sha256 was not found."
(
  cd "$download_dir"
  sha256sum -c "$archive_name.sha256"
)
unzip -tq "$archive_path" >/dev/null || die "The Web archive is damaged."
if unzip -Z1 "$archive_path" | grep -E '(^|/)(\.env|[^/]*\.(jks|keystore)|signing\.properties|key\.properties)$' >/dev/null; then
  die "Private environment/signing material must not be in the Web archive."
fi

temp_dir="$(mktemp -d "${TMPDIR:-${PREFIX:-/data/data/com.termux/files/usr}/tmp}/nav-kurd-web-v9.XXXXXX")"
unzip -q "$archive_path" -d "$temp_dir/source"
source_root="$temp_dir/source/$expected_root"
[[ -s "$source_root/package.json" && -s "$source_root/release.config.json" ]] ||
  die "The expected $expected_root source root is missing."
node -e '
  const p=require(process.argv[1]);
  const r=require(process.argv[2]);
  if(p.version!=="9.0.0"||r.appVersion!=="9.0.0"||r.uiTheme!=="luxe-ocean") process.exit(1);
' "$source_root/package.json" "$source_root/release.config.json" || die "The archive is not the final v9 luxe-ocean release."

echo "3/8 — Cloning the private canonical Web repository..."
visibility="$(retry gh repo view "$repo" --json visibility --jq .visibility)"
[[ "$visibility" == "PRIVATE" ]] || die "$repo must remain PRIVATE."
repo_dir="$temp_dir/repo"
retry gh repo clone "$repo" "$repo_dir"
git -C "$repo_dir" switch main
retry git -C "$repo_dir" -c http.version=HTTP/1.1 pull --ff-only origin main
branch="codex/nav-kurd-web-v9-$(date -u +%Y%m%d-%H%M%S)-$$"
git -C "$repo_dir" switch -c "$branch"

echo "4/8 — Overlaying the complete, secret-safe v9 source..."
rsync -a \
  --exclude='.git/' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  "$source_root/" "$repo_dir/"
git -C "$repo_dir" rm -f --ignore-unmatch \
  HANDOFF_WEB_8.0.4.md \
  NAV-KURD-v8.0.4-PUBLISH-RUNTIME-FIXES.sh \
  public/assets/android-brand.png \
  src/styles/ambient-weather.css
(
  cd "$repo_dir"
  git diff --check
  node tools/verify/source.mjs
  node tools/verify/runtime.mjs
  node tools/verify/security.mjs
  node tools/verify/release.mjs
)

echo "5/8 — Uploading a review branch..."
git -C "$repo_dir" add -A
if git -C "$repo_dir" diff --cached --quiet; then
  echo "The Web repository already contains this exact v9 source."
  git -C "$repo_dir" switch main
  git -C "$repo_dir" branch -D "$branch"
  main_sha="$(git -C "$repo_dir" rev-parse main)"
else
  git -C "$repo_dir" config user.name "$account"
  git -C "$repo_dir" config user.email "$account@users.noreply.github.com"
  git -C "$repo_dir" commit -m "Release NAV KURD Web 9.0.0 luxe interface"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  retry git -C "$repo_dir" -c http.version=HTTP/1.1 push -u origin "$branch"
  pr_url="$(retry gh pr create \
    --repo "$repo" \
    --base main \
    --head "$branch" \
    --title "NAV KURD Web 9.0.0 luxe interface" \
    --body "Web-first v9 release: luxe blue/white UI, new loader/download experience, repaired sharing/photo selection/GPS focus, multilingual polish, release hardening and production docs.")"

  echo "6/8 — Waiting for production, Chromium and migration checks..."
  run_id=""
  for _ in $(seq 1 90); do
    run_id="$(gh run list --repo "$repo" --workflow quality.yml --branch "$branch" \
      --event pull_request --limit 20 --json databaseId,headSha \
      --jq "map(select(.headSha == \"$head_sha\"))[0].databaseId // empty" 2>/dev/null || true)"
    [[ -n "$run_id" ]] && break
    sleep 5
  done
  [[ -n "$run_id" ]] || die "The Web quality workflow was not found: $pr_url"
  if ! gh run watch "$run_id" --repo "$repo" --exit-status; then
    gh run view "$run_id" --repo "$repo" --log-failed > "$download_dir/GEO-WEB-V9-ERROR-$run_id.txt" 2>&1 || true
    die "Web checks failed; the report is in Android Download."
  fi
  retry gh pr merge "$pr_url" --repo "$repo" --squash --delete-branch
  retry git -C "$repo_dir" fetch origin main
  git -C "$repo_dir" switch main
  git -C "$repo_dir" merge --ff-only origin/main
  main_sha="$(git -C "$repo_dir" rev-parse HEAD)"
fi

echo "7/8 — Applying the v9 Supabase migration/functions gate..."
if gh workflow view supabase-deploy.yml --repo "$repo" >/dev/null 2>&1; then
  retry gh workflow run supabase-deploy.yml --repo "$repo" --ref main \
    -f mode=all -f confirm=DEPLOY -f repair_legacy_history=false
  sleep 4
  deploy_run="$(gh run list --repo "$repo" --workflow supabase-deploy.yml --branch main \
    --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
  [[ -n "$deploy_run" ]] || die "The Supabase deployment run could not be found."
  gh run watch "$deploy_run" --repo "$repo" --exit-status
fi

echo "8/8 — Web-first release complete."
echo "Main commit: $main_sha"
echo "Vercel will deploy from private main before the Android build begins."
echo "Next: run NAV-KURD-v9.0.0-ANDROID-TERMUX.sh"
