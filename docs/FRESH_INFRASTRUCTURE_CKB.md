# ڕێبەری ژێرخانی تازە — NAV KURD 8.0.4

ئەم ڕێبەرە بۆ ئەکاونتی کۆتایی `sarhang-sg` ـە. هەردوو کۆگاکە دەبێت
Private بن:

- `sarhang-sg/GEO-MAP`
- `sarhang-sg/GEO-ANDROID`

هیچ JKS، پاسوۆرد، `.env.local`، database password یان service-role key ـێک
نابێت بچێتە Git یان ZIP. سەبەیسی/Vercel/GitHub ـی کۆن تا تەواوبوونی
تاقیکردنەوەکان وەک backup بە زیندوویی بهێڵەوە.

## 1. سەرەتا وێب ئەپ بڵاو بکەرەوە

ئەم فایلانە بە هەمان ناو بخەرە Download ـی مۆبایل:

- `NAV-KURD-v8.0.4-WEB.zip`
- `NAV-KURD-v8.0.4-ANDROID.zip`
- `NAV-KURD-v8.0.4-FRESH-SETUP.sh`
- `SHA256SUMS.txt`

لە Termux:

```bash
termux-setup-storage
bash /storage/emulated/0/Download/NAV-KURD-v8.0.4-FRESH-SETUP.sh setup
bash /storage/emulated/0/Download/NAV-KURD-v8.0.4-FRESH-SETUP.sh login
bash /storage/emulated/0/Download/NAV-KURD-v8.0.4-FRESH-SETUP.sh web
```

سکریپتەکە SHA-256 و ZIP و secret leak دەپشکنێت، کۆگای Private دروست دەکات
و clean `main` بۆ `sarhang-sg/GEO-MAP` دەنێرێت. `force push` و overwrite
ناکات. ئەگەر کۆگاکە پێشتر commit ـی تێدابێت، بە ئەنقەست دەوەستێت.

## 2. سەبەیسی نوێ

### 2.1 هەڵبژاردنی ڕێگای داتا

- ئەگەر داتای کۆن، Auth users و فایلەکانت پێویستن: سەرەتا backup بکە و
  official Restore/backup-restore ـی Supabase بەکاربهێنە. دواتر workflow ـی
  database تەنها migration ـە نەکراوەکان جێبەجێ دەکات.
- ئەگەر بەڕاستی database ـێکی بەتاڵت دەوێت: workflow ـی database هەموو 21
  migration ـەکە لە ڕیزبەندی ناوی فایل جێبەجێ دەکات.

تەنها rerun کردنی SQL داتای کۆن، Auth users یان object bytes ناگوازێتەوە.
Storage object ـەکان بە Storage API/CLI جیاواز دەگوازرێنەوە. project ـی کۆن
مەسڕەوە تا ژمارەی users/rows/files لە هەردوو لا پشکنراوەتەوە.

### 2.2 GitHub Secrets بۆ database

لە Supabase:

- Account → Access Tokens: token ـێکی نوێ دروست بکە.
- Project Settings → General: `Project ID / ref` وەربگرە.
- Project Settings → Database: database password ـەکە بەکاربهێنە.

لە Termux، هەر command ـێک بە تەنیا جێبەجێ بکە؛ `gh` بە شێوەی نهێنی داوای
value دەکات:

```bash
gh secret set SUPABASE_ACCESS_TOKEN --repo sarhang-sg/GEO-MAP
gh secret set SUPABASE_PROJECT_ID --repo sarhang-sg/GEO-MAP
gh secret set SUPABASE_DB_PASSWORD --repo sarhang-sg/GEO-MAP
```

پاشان SQL ـەکان جێبەجێ بکە:

```bash
gh workflow run supabase-deploy.yml \
  --repo sarhang-sg/GEO-MAP \
  -f mode=database \
  -f confirm=DEPLOY
```

وەستان و ئەنجام ببینە:

```bash
SUPABASE_RUN_ID="$(gh run list \
  --repo sarhang-sg/GEO-MAP \
  --workflow supabase-deploy.yml \
  --limit 1 \
  --json databaseId \
  --jq '.[0].databaseId')"
gh run watch "$SUPABASE_RUN_ID" --repo sarhang-sg/GEO-MAP --exit-status
```

### 2.3 ڕێکخستنی dashboard

لە project ـی نوێ ئەمانە پشکنە:

1. Data API: ON.
2. Automatically expose new tables: OFF.
3. RLS بۆ public tables: ON؛ migration ـەکان policy ـەکان دادەنێن.
4. Realtime: تەنها table ـە پێویستەکان enable بکە.
5. Storage bucket ـەکان: `kri-place-media` و
   `kri-place-media-private`؛ public/private و policy ـەکان بەپێی migration.
6. Auth → URL Configuration:
   - Site URL: `https://geo-map-kappa.vercel.app`
   - Redirect URLs: `https://geo-map-kappa.vercel.app/**`
7. Auth → Providers → Google: Google provider چالاک بکە و Client ID/Secret ـی
   Google Cloud Web application دابنێ.
8. لە Google Cloud → OAuth Web client، ئەم callback ـە وەک Authorized redirect
   URI زیاد بکە:
   `https://kaydgjhwnspnuqabaiqw.supabase.co/auth/v1/callback`
9. migration ـی `20260828_000022_fresh_backend_owner_contract.sql` ئەکاونتی
   `s.pasha0101@gmail.com` لە private allow-list دادەنێت؛ لە یەکەم Google login
   ـدا trigger ـەکە خۆکارانە ڕۆڵی admin دروست دەکات.

ئەم migration ـە هەروەها Auth/notification/presence/RLS، پێنج table ـی
Realtime و دوو bucket ـی ڕاستەقینە دەپشکنێت. ئەگەر یەکێکیان کەم بێت workflow
بە error دەوەستێت و backend ـی نیمچە بڵاوناکرێتەوە.

## 3. Vercel ـی نوێ

1. Vercel → Add New → Project → Import Git Repository.
2. GitHub App ـی Vercel ڕێگەی تەنها بۆ private repo ـی
   `sarhang-sg/GEO-MAP` پێبدە.
3. Framework: Vite.
4. Build command: `npm run build:vercel`.
5. Output directory: `dist`.
6. Install command: `npm ci`.
7. پێش Deploy، Environment Variables ـەکان بۆ Production/Preview دابنێ.

### 3.1 Vercel Environment Variables

| ناو | جۆر | سەرچاوە |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Public | Supabase Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public | Supabase publishable key |
| `VITE_KRI_MAPTILER_API_KEY` | Public/restricted | MapTiler browser key |
| `VITE_KRI_MAPBOX_ACCESS_TOKEN` | Public/restricted | Mapbox public token |
| `VITE_KRI_MEDIA_BUCKET` | Public | `kri-place-media` |
| `VITE_KRI_PRIVATE_MEDIA_BUCKET` | Public | `kri-place-media-private` |
| `NAV_KURD_CANONICAL_ORIGIN` | Server | URL ـی نوێی Vercel |
| `NAV_KURD_SENTINEL_ALLOWED_ORIGINS` | Server | URL ـی نوێی Vercel |
| `VITE_PUBLIC_APP_URL` | Public | URL ـی نوێی Vercel |
| `CDSE_SH_CLIENT_ID` | Sensitive | Copernicus، ئەگەر Sentinel بەکاردێت |
| `CDSE_SH_CLIENT_SECRET` | Sensitive | Copernicus، ئەگەر Sentinel بەکاردێت |

هەموو default/optional variable ـەکانی تر لە `.env.example` ـدان. database
password، Supabase secret/service-role key و JKS مەخەرە Vercel browser env.

### 3.2 URL ـی production

Production domain ـی دیاریکراو `https://geo-map-kappa.vercel.app` ـە.
Canonical origin، App Links، redirect، sitemap، legal links و update feed لە
هەردوو project ـدا بۆ ئەم domain ـە یەکخراون و دەبێت هەر بە یەکەوە
validate بکرێن.

Edge Functions ـەکان بۆ production origin:

```bash
gh variable set NAV_KURD_ALLOWED_ORIGINS \
  --repo sarhang-sg/GEO-MAP \
  --body "https://geo-map-kappa.vercel.app"

gh workflow run supabase-deploy.yml \
  --repo sarhang-sg/GEO-MAP \
  -f mode=functions \
  -f confirm=DEPLOY
```

## 4. Android ـی نوێ

دوای تەواوبوونی URL/Supabase/Web:

```bash
bash /storage/emulated/0/Download/NAV-KURD-v8.0.4-FRESH-SETUP.sh android
bash /storage/emulated/0/Download/NAV-KURD-v8.0.4-FRESH-SETUP.sh signing
bash /storage/emulated/0/Download/NAV-KURD-v8.0.4-FRESH-SETUP.sh android-build
```

`signing` تەنها JKS ـی دامەزراوی پێشوو وەردەگرێت، fingerprint ـەکە بە
SHA-256 ـی NAV KURD دەپشکنێت و دواتر چوار secret ـەکە بۆ
`sarhang-sg/GEO-ANDROID` دەنێرێت. key ـی نوێ دروست ناکات.

## 5. ئەکاونت/خزمەتگوزارییەکانی تری پێویست

| خزمەتگوزاری | کار |
| --- | --- |
| Google Cloud Console | Supabase callback URL و Vercel origin/redirect ـی نوێ زیاد بکە |
| MapTiler | URL restriction ـی browser key بۆ domain ـی نوێ بگۆڕە |
| Mapbox | Allowed URL ـی public token بۆ domain ـی نوێ بگۆڕە |
| Copernicus Data Space | client ID/secret لە Vercel دابنێ یان rotate بکە |
| APKPure | package/fingerprint هەمانە؛ APK 8.0.4 و What's New نوێ بکە |
| GitHub Pages CV | لینکی کۆنی `sarhang-cs.github.io/Sarhang-Cv` بگوازەوە یان نوێ بکەرەوە |
| Apple Developer | تەنها ئەگەر iOS بڵاودەکەیتەوە، `APPLE_TEAM_ID` و Universal Links |

Open-Meteo، MapLibre و OSRM ـی default ئەکاونتیان ناوێت. ئەگەر custom domain
هەیە، DNS/SSL ـیش دوای production URL ڕێکبخە.
