# Handoff

Tasks from Claude chat for Claude Code. Claude Code: work the top open task, then move it to Done and update `STATUS.md`.

## Open

### Dipstick 2.0: optional accounts and cross-device sync (Supabase)

_Written 2026-10-11 by Claude chat. Curt approved the direction: add a database and login so people keep their data across phones, browsers and the Play app._

**Goal:** sign in once and the same garage shows up on every device. Losing a phone or clearing Chrome no longer means losing a car's history.

**Ground rules (these change the "No server, ever" rule in `CLAUDE.md`; update that file as part of this task):**
- **Accounts are optional.** Signed out, Dipstick works exactly as it does today, local only. Nothing is uploaded until someone signs in.
- **Local-first stays.** localStorage remains the working copy. Supabase is the backup and sync layer, so the app keeps working offline and if Supabase is down or paused.
- **Separate Supabase project `dipstick`.** Do not use the `trellis` project. Trellis holds shop customers' call data and is set up for an audit; consumer accounts stay out of it.
- Security per Curt's standard (SOC 2 / ISO 27001 aligned): RLS on every table, no secrets in client code, a `SECURITY.md` evidence file like Trellis has.

#### Stack
- Supabase: Postgres, Auth, Storage. Project URL and anon key in the client (safe; RLS protects data). Service role key only in Netlify env vars.
- Auth: **Google sign-in + email magic link.** No passwords to manage. Custom SMTP through **Resend** on `dipstick.cool` (sender e.g. `Dipstick <hello@dipstick.cool>`), because Supabase's built-in mailer only reaches team members. DNS records go in Netlify DNS.
- Netlify Function only for account deletion (needs the service role key).
- Add `netlify.toml`: security headers, a strict CSP (`connect-src` = self, the Supabase project, `vpic.nhtsa.dot.gov`, `api.nhtsa.gov`), and 404s for repo-only files (`*.md`, `README.txt`, `supabase/`).
- Vendor `supabase-js` as a local file (see Trellis `scripts/vendor.mjs` and `public/vendor/supabase.js`) instead of a CDN.

#### Data model (migration `supabase/migrations/001_accounts_sync.sql`)
The app's state is one JSON object with nested vehicles. To ship fast without rewriting `app.js`, store it per vehicle as validated jsonb:

| Table | Columns | Notes |
| --- | --- | --- |
| `garages` | `user_id uuid pk -> auth.users on delete cascade`, `settings jsonb` (providers, inventory, currency), `updated_at` | One row per user |
| `vehicles` | `id text`, `user_id uuid -> auth.users on delete cascade`, `data jsonb`, `updated_at timestamptz`, `deleted_at timestamptz null`; pk `(user_id, id)` | One row per car. `id` is the app's existing vehicle id. Soft delete so other devices learn about deletions |

- `user_id default auth.uid()`; column grants so it can't be changed after insert.
- RLS on both tables: select/insert/update/delete only where `user_id = auth.uid()`. Anon role gets nothing.
- Check constraints: `data` is an object, `pg_column_size(data) < 2 MB`, `id` matches the app's id format.
- `updated_at` set by a BEFORE trigger (server time), not trusted from the client.
- Storage bucket `documents` (private): path `{user_id}/{vehicle_id}/{doc_id}`, RLS on `storage.objects` so a user only reaches their own folder, 10 MB limit, images and PDF only.

#### Sync behavior
- **On sign-in, first time on this device:**
  - Account empty, phone has data: "Upload this phone's garage to your account?" Yes uploads everything.
  - Account has data, phone empty: download it.
  - Both have data: merge by vehicle id; same car on both sides keeps the newer `updated_at`. Show what happened in one line ("2 cars from your account, 1 from this phone").
- **While signed in:** every save (`scheduleSave`) also queues the changed vehicle (or garage settings) for upload. Debounce, then upsert. On app open and on regaining focus, pull rows with `updated_at` newer than the last sync.
- **Conflicts (v2.0):** last write wins per vehicle. Good enough for one person on a couple of devices. Note in STATUS.md if per-record merging looks needed.
- **Offline:** keep a pending-upload list in localStorage; flush when back online.
- **Status chip** in the header: Synced / Saving / Offline, changes saved on this phone / Not signed in. Errors must never look like an empty garage.
- **Document files:** keep `dataUrl` out of the synced jsonb. The file goes to the Storage bucket and the row keeps its path. Documents previously promised "stored on this device only", so the upload happens only when signed in, and the Documents tab copy changes to say so.
- **Sign out:** ask whether to keep a copy on this device or clear it (for shared or borrowed phones).

#### Account and privacy (required by Google Play once accounts exist)
- **Delete my account** in Settings and on a public web page (Play requires a web link too). Netlify Function verifies the user's token, deletes their Storage files, then deletes the auth user (rows cascade). Local data on the device stays unless they also clear it.
- **Export** keeps working (JSON backup), signed in or not.
- Rewrite `privacy.html`: what's stored when signed in (garage data, documents, email), third parties (Supabase, Netlify, Resend, Google sign-in, NHTSA), retention, how to delete, contact `5thwarddev@gmail.com`.
- Update the store listing and the **Play Console Data safety form** (email address and app data are now collected, encrypted in transit, deletable). Curt does this in Play Console; it triggers a Google review. Ship the account code behind a flag until the form is approved.

#### What Curt does (put exact steps in the hand-off when done)
1. Create Supabase project `dipstick` (free to build; Pro before real users so it doesn't pause and has backups).
2. Auth settings: Google provider, magic link, site URL `https://dipstick.cool`, redirect URLs, custom SMTP with Resend.
3. Google Cloud: OAuth client for `dipstick.cool`, consent screen with the privacy page URL.
4. Resend: add `dipstick.cool`, DNS records in Netlify DNS, API key into Supabase SMTP settings.
5. Apply the migration with the PowerShell clipboard command, then SQL Editor > New query > Ctrl+V > Run.
6. Netlify env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (secret).
7. Play Console: update Data safety and the account deletion URL.

#### Build order
1. `netlify.toml` (headers, CSP), vendored supabase-js, config endpoint or inline public config.
2. Migration + SQL attack tests (other user, signed out, changing `user_id`, oversized rows, other users' Storage paths), run against a local Postgres with a Supabase auth stand-in like Trellis `test/db/`.
3. Sign-in UI (Google + magic link) behind a feature flag; sign-out flow.
4. Sync engine in `app.js`: first-sign-in merge, push queue, pull on open/focus, status chip.
5. Document files to Storage.
6. Delete-account function + web page; privacy page rewrite.
7. End-to-end test with two devices (two browser profiles), offline then online, and the Play app (Google sign-in inside the TWA).
8. Security review (security-compliance agent), `SECURITY.md`, then turn the flag on after Play approves the Data safety change.

**Must keep working before Curt applies the migration:** if Supabase is unreachable or tables are missing, hide sign-in and run local-only. No errors on screen.

**Out of scope for this task:** reminders by email/text, Trellis shop booking, shop-verified records, the Intervals redesign. Those are next.

## Done
- (nothing yet)
