# Dipstick

Local-first vehicle maintenance tracker. Live at https://dipstick.cool. Android app "Dipstick — Garage Log" (`cool.dipstick.twa`) in Google Play closed testing.

## Stack
- Static site, no build step, no server, no accounts. All data stays in the browser (localStorage), with JSON backup/restore.
- `app.js` is the shared engine (math + storage); pages are `index.html`, `vehicle.html`, `providers.html`.
- PWA: `manifest.json` + `sw.js`. Android Digital Asset Links: `.well-known/assetlinks.json`.
- Features and design decisions: `README.txt`. Hosting, Play Console and history: `DEPLOYMENT.md` (read it before touching deploys).

## Deploy
Push to `main` and Netlify auto-deploys (project `serene-brigadeiros-8978a1`). Test locally with `py -m http.server 8000`; opening the file directly doesn't save data.

## Rules
- **No server, ever.** Don't add a backend, accounts or tracking. Data never leaves the device.
- Never remove either fingerprint from `.well-known/assetlinks.json`, or the Play app breaks.
- Curt's local copy is `C:\Users\husll\Downloads\dipstick`. Git Bash is installed inside it at `dipstick\Git\` (gitignored). Don't move or delete that folder.
- Curt is on Windows: give PowerShell commands.

## How work moves between Claude (chat) and Claude Code

This repo is shared by two Claude sessions:
- **Claude chat** (claude.ai): plans, specs, research, copy. Writes `HANDOFF.md`.
- **Claude Code** (on Curt's laptop): builds, tests, commits. Updates `STATUS.md`.

**At the start of every Claude Code session:**
1. `git pull` so you have whatever chat pushed.
2. Read `HANDOFF.md`. If it has an open task, that is the job. If it says "No open task", ask Curt what to work on.
3. Read `STATUS.md` for where things stand.

**Before ending a session (or after finishing a task):**
1. Update `STATUS.md`: date, what you built, what's broken or untested, open questions for Curt or chat.
2. In `HANDOFF.md`, mark the task done (move it under "Done") or note exactly where you stopped.
3. Commit and push, so chat can see it.

Keep both files short. `STATUS.md` is the current state, not a diary: rewrite it, don't append forever.
