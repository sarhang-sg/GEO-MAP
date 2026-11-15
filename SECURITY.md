# NAV KURD 11.0.0 security policy

Report vulnerabilities privately to **sarhang.salah9@gmail.com**. Include the affected version, origin, browser or Android version, reproduction steps and expected impact. Redact session tokens, precise location, account identifiers and private submissions.

## Browser and server boundaries

The browser uses only public deployment values. Supabase receives a publishable or anon key. Mapbox client tokens are public and should be origin restricted. Server-only provider credentials, signing material and Supabase service-role keys belong in the deployment secret store. The packaged Android UI reads the same browser-public configuration over HTTPS.

Supabase row-level security controls access to account data. Weather favorites are keyed by the authenticated user and city coordinates. The weather proxy validates request scope, coordinates and forecast bounds and returns an unavailable state when upstream data cannot be obtained. The app keeps timestamps with cached forecasts.

## Release integrity

Production builds verify the public Android receipt, filename, size, SHA-256 and expected signing certificate before advertising a download. Offline asset integrity and the deployment commit can be checked against the corresponding manifests. Rotate affected provider credentials and invalidate exposed sessions if a secret or token is disclosed.

[Public disclosure policy](https://geo-map-kappa.vercel.app/legal/security.html)
