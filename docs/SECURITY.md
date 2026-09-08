# Security

Browser security is enforced with CSP, HSTS, frame denial, MIME sniffing protection, bounded permissions and same-origin resource policies. API responses are non-cacheable and non-indexable.

Supabase public tables use Row Level Security. Security-definer functions have explicit search paths. Browser code receives only the public URL and publishable key; secret/service-role credentials remain server-side.

Release packaging excludes private environment files, dependency folders, build output, editor state and caches. `RELEASE_MANIFEST.json` records SHA-256 identities for packaged source files.
