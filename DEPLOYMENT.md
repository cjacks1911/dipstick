# Dipstick — Deployment Notes

Written 26 Aug 2026. Read this before touching hosting/deploy for this project —
it exists so a future session (or future you) doesn't have to rediscover any of
this from scratch.

## The pipeline, as it stands today

- **Live site:** https://dipstick.cool
- **Netlify project:** `serene-brigadeiros-8978a1`
  (site id `ea9947ca-1816-4394-875a-fa9e6326dfe8`)
  admin: https://app.netlify.com/projects/serene-brigadeiros-8978a1
- **GitHub repo:** https://github.com/cjacks1911/dipstick (branch `main`)
- **Local working copy:** `C:\Users\husll\Downloads\dipstick` on Curt's laptop —
  this folder IS the git repo (`git init` was run here directly, not a fresh clone).

**How a change goes live:** edit the files in the local working copy → commit →
`git push` → Netlify auto-deploys `main` within seconds. No build step, no
build command — it's a static site, publish directory is the repo root.

## How this got set up (context for why it looks the way it does)

- Netlify project was originally deployed by hand via Netlify Drop
  (drag-and-drop), not Git. On 26 Aug 2026 someone dropped the **HUSLLYFE**
  project's folder onto this site by mistake — dipstick.cool briefly served
  HUSLLYFE (different app, different project: `poetic-dango-630de4` /
  husllyfe.com) instead of Dipstick. Caught it by checking manifest.json,
  the service worker, and page titles on the live domain — none of them said
  "Dipstick." Confirmed via the Netlify deploy record too: that deploy's
  `deploy_source` was `"drop"` and it had 8 header rules processed, which
  matches HUSLLYFE's `_headers` file — Dipstick doesn't ship one.
- Fixed by re-dropping the correct Dipstick folder that same day.
- To stop that from happening again, set up real Git-based deployment same
  day: `git init` in the local folder, pushed to a new GitHub repo
  (`cjacks1911/dipstick`), then linked that repo to the Netlify project via
  Site configuration → Build & deploy → Link repository. Confirmed working —
  the live deploy's `commit_ref` now matches the exact commit hash pushed to
  GitHub, `manual_deploy: false`.
- Local machine's Git Bash install (`git-bash.exe` etc.) landed inside this
  same folder (`dipstick\Git\`) rather than its usual location — harmless,
  but it's in `.gitignore` so it never gets committed. Safe to ignore, or
  move it out if it bothers you.

## Things worth knowing before changing anything here

- There's no Netlify MCP tool that pushes arbitrary files as a deploy — the
  only way updates go out is a real `git push`. A future session can commit
  to this repo (if it has shell/device access to this folder) but can't
  "deploy" through the Netlify connector directly.
- The Netlify connector (in Claude/Cowork) is authorized at the account
  level, so it'll already be available in a new session without
  reconnecting — but check `get-projects` to rediscover the site id rather
  than assuming, in case anything changes.
- There is no `robots.txt` on this site. Not urgent, but worth adding if
  search visibility ever becomes a goal.
- See `README.txt` in this same folder for what the app actually does
  (features, architecture, "no server, ever" constraint). See the
  feature-backlog Artifact for the shipped/bench feature history:
  https://claude.ai/code/artifact/f2234836-048a-4a2b-998b-2b1b5f9e545d

## Google Play — status as of 13 Sep 2026

- **Play Console account:** "Husllyfe" (personal), signed in as 5thwarddev@gmail.com,
  developer ID 6475154559821654228. Identity verified 7 Sep 2026.
- **App:** "Dipstick — Garage Log", package `cool.dipstick.twa`, app ID 4975370475934097201,
  free, category Auto & Vehicles, contact 5thwarddev@gmail.com / https://dipstick.cool.
- **Android package:** built with PWABuilder on 28 Aug 2026. Lives in
  `C:\Users\husll\Downloads\Dipstick - Google Play package\` on Curt's laptop:
  `.aab` (uploaded, version code 1 / 1.0.0.0), `.apk`, `signing.keystore` +
  `signing-key-info.txt` (BACK THESE UP — the only key that can sign updates),
  and `store-listing\` (icon, feature graphic, phone/7"/10" screenshots).
- **Digital Asset Links:** `.well-known/assetlinks.json` in this repo carries BOTH
  fingerprints — Google's app-signing key (CB:42:4D:…:DD:4E, from Play Console →
  App integrity) and the PWABuilder upload key (4A:3A:3D:…:5D:20). Live at
  https://dipstick.cool/.well-known/assetlinks.json. Don't remove either.
- **Tracks:** Internal testing has release 1 (1.0.0.0) live. Closed testing "Alpha"
  (US only) with the same bundle was submitted for Google review on 13 Sep 2026
  together with the store listing and all app-content declarations (privacy policy
  URL, no sign-in, no ads, no advertising ID, content rating Everyone/PEGI 3,
  target 18+, data safety = nothing collected/shared, not gov/financial/health).
- **Testers:** one account-wide email list, "Dipstick internal testers" (26 addresses),
  attached to both tracks. Internal opt-in link:
  https://play.google.com/apps/internaltest/4700716231126918246 — the closed-test
  link appears in Play Console → Closed testing → Testers once the review passes.
- **Path to public:** closed test needs ≥12 testers opted in continuously for 14 days,
  then "Apply for production" on the dashboard, then Google reviews again.
- **If ads are ever added:** the app is a TWA, so AdMob's native SDK can't be used —
  AdSense on the site is the route. That flips the Ads + Advertising ID declarations,
  changes Data safety, and contradicts the "no ads / nothing leaves the device" copy
  in privacy.html and the store listing.
- **Screenshot generator:** screenshots were produced with Playwright against a local
  copy of this site seeded with sample localStorage state (2005 E500 + 2019 Tacoma);
  re-run the same idea if the UI changes.
