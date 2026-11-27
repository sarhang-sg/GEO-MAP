# NAV KURD development checkpoint

- Web baseline: `GEO-MAP` `aeed74d`. Android baseline: `GEO-ANDROID` `2507671` (110004). Work stays on `codex/nav-kurd-stability` branches until verification.
- Recovered the pending shared locality viewport fix and its regression. Catalog updates now reconcile visible villages at a stationary camera, including geometry and category corrections. Map reconciliation checks and TypeScript passed.
- The previous session completed a clean web baseline build and installed locked Flutter dependencies. It left route and forecast probes, a UI preview, and offline cache findings. Only the locality fix survived in the source worktrees.
- Pending: finish the route performance probe, weather, offline cache and UI fixes, rebuild Android's shared presentation, and verify both repositories. Android 110004 requires matching presentation metadata. Inspect `origin/build/prepare-widget-110004` for the known metadata alignment.
