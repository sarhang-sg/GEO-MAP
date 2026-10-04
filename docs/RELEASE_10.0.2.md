# NAV KURD 10.0.2 — approved UI wording

Source input: `NAV-KURD-10.0.1-FINAL-MASTER (1).xlsx`.
SHA-256: `4ce6d00467f1bac6e840db5605819d121e3a12e33f2e924685237a491c1b9fc2`.

Reviewed all 4,765 entries; 246 edited entries were found. Handled 244 entries
(199 Kurdish, 25 Arabic, 20 English) across the web UI, Android presentation,
widget, notification copy, legal pages and server message templates.

Two rows incorrectly included in the UI export were technical character maps
for Kurdish search normalization. The owner's removal markers for those rows
are excluded from executable code; both alphabets remain intact. Five corrected
search spellings are available alongside the previous spellings: one new synonym
was added, and four corrected forms were already supported. No duplicate aliases
were added. Approved named count placeholders use the existing compatible
formatters. Spaces between concatenated diagnostic and attribution fragments
remain visible without changing the approved words.

Version name: **10.0.2**. Android version code: **100002**.
The V10 offline dataset and signing identity are unchanged. This release does
not alter design styles, stored places, user accounts or downloaded map data.

The new Supabase migration replaces eight existing functions with the same
logic and twelve approved string-literal edits. Historical migrations and sent
notification records remain unchanged. The account-deletion Edge Function also
contains its approved message edit. Deployment uses the existing protected
production workflow; the updater verifies the deployment job actually ran.

Use `NAV-KURD-10.0.2-WORDING.sh` from the delivery package in Termux. It verifies
both repository bases, pushes only the reviewed changes, waits for the existing
signed Android build, verifies the package/version/signing certificate and every
bundled UI hash, publishes the signed release, and binds the web download feed to
that exact APK. It then verifies web CI, Vercel production and server deployment.
It stops on unrelated source changes or failed/pending gates and can resume.

The source archive is not a signed APK. Android's existing CI must build and sign
the new version. The SQLite catalog remains an unchanged Git LFS object, fetched
by the existing CI; the source archive retains its verified LFS pointer.
