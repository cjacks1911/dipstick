DIPSTICK — local testing
=========================

RECOMMENDED: run a local web server from this folder, e.g.
  Python:  py -m http.server 8000     then open http://localhost:8000/index.html
  Node:    npx serve .                then open the URL it prints
  VS Code: install "Live Server", right-click index.html > Open with Live Server

Chrome blocks localStorage on file:// URLs, so opening index.html directly
means nothing you enter will be saved.

QUICK LOOK ONLY: double-click index.html — the site renders and navigation
works, but nothing you enter will persist between page loads.

WHAT'S HERE (v1 — ported from HUSLLYFE's Garage engine, since it was already
built and tested, plus new features built from a competitor scan)

CORE, PORTED AND PROVEN
  - Multi-vehicle garage: add/edit/delete, notes, current mileage
  - VIN lookup via NHTSA's free public database (year/make/model/trim/engine)
  - Safety recall check via NHTSA, cached with the date it was fetched
  - "Repair" in the Log a Service type field: picks from the same
    suggestion list as Oil Change, Tire Rotation, etc., but deliberately
    isn't added to the recurring interval schedule — a repair is a one-off
    fix, not something that should start nagging you for the "next one" on
    a fixed mileage/month cycle the way an oil change does. Logging one
    still counts toward the vehicle's mileage confirmation and shows up in
    the service history table same as anything else; if you do want to
    track a specific repeat repair on its own interval, the Intervals
    editor below lets you set one for it just like any custom type.
  - Service schedule: ~20 make-specific interval sets + a generic fallback,
    every figure editable, severe-duty scaling, blank a box to switch a
    dimension off
  - Due tracking: mileage AND time, whichever arrives first; "due soon" at
    10% of the interval remaining; a projected due DATE fitted from your own
    logged odometer readings
  - One-page printable service record (Print / Save PDF)
  - Reminders: an always-accurate in-app panel, plus opt-in browser
    notifications via a service worker (grouped, never one per item,
    Chromium-only, needs the app installed to fire in the background) — the
    "Send a test" button fires the real code path immediately
  - Local-only storage, no account, no server; JSON backup/restore

NEW IN DIPSTICK (built from a scan of AUTOsist, Drivvo, Simply Auto, Fuelly,
CARFAX Car Care, aCar, GarageHub, FIXD/OBDeleven and others — see the
feature-backlog page for the full comparison and what was deliberately left
out)
  - Fuel log with real-world MPG (or mi/kWh for an EV), computed the same
    way Fuelly/Drivvo do it: only between consecutive FULL fill-ups
  - True cost of ownership per mile: depreciation PLUS every logged dollar
    (maintenance + parts + fuel), which none of the researched competitors
    combine into one number
  - Document vault: registration, insurance, title, warranty booklet —
    stored on-device, with an optional expiry date that feeds reminders
  - Warranty tracker: expires by date or by mileage, surfaces in reminders
    as it approaches
  - Parts & tires: install date/mileage + expected life, "replace soon"
    flags; tire tread-depth log with a wear status
  - Service provider directory: a shared shop list across every vehicle,
    with "who did I use last time for this?" built in — a direct answer to
    CARFAX's most-repeated complaint (no way to credit an independent shop)
  - CSV export per log (maintenance / fuel / parts), on top of the PDF
  - .ics calendar export for everything currently due, so reminders land in
    your own calendar app too — nobody in the research offered this
  - No badges, no gamification, no guilt — reports status, never scolds
  - GPS trip logging (per vehicle, "Trips" tab): start/stop while the tab
    is open, distance by GPS, a small route sketch, editable purpose. Needs
    HTTPS — Chrome/Edge refuse geolocation on a plain opened file, which is
    why this didn't ship in v1 and does now that it's hosted. Foreground-
    only by design of the web platform itself: no browser lets a site track
    location once its tab is closed, hosted or not, so this isn't the
    always-on background logging Simply Auto does.
  - OBD2 diagnostics (per vehicle, "OBD2" tab): connect a Bluetooth adapter,
    read live RPM/speed/coolant/fuel level, read and clear trouble codes
    with plain-language descriptions for ~40 common generic codes. Also
    needs HTTPS. Real limit worth knowing: Web Bluetooth only reaches
    Bluetooth LOW ENERGY devices, in Chrome or Edge only (never Safari or
    iOS, anywhere). Most classic $10 ELM327 dongles use Bluetooth Classic
    and are invisible to any website — this works with BLE adapters
    specifically (Vgate iCar Pro BLE, OBDLink CX/MX+, Kiwi 3, and similar
    clones). Could not be tested against real hardware while building this
    — the build environment has no Bluetooth adapter — so treat your first
    real connection attempt as the actual test.
  - Light/dark theme toggle: a sun/moon button in the header switches the
    whole app between a dark and a light palette, saved in localStorage per
    browser. Defaults to matching the OS/browser setting until you pick one
    explicitly. No flash of the wrong theme on load or reload.
  - Insurance claim log (per vehicle, "Insurance" tab): a dedicated record
    for accidents and claims, separate from routine maintenance — category,
    insurer, what happened, amount claimed/deductible/paid out, and a
    filed/approved/denied/closed status. CSV export like the other logs.
  - Parts inventory (dashboard, "Parts Inventory" panel): garage-wide stock
    of spares you keep on hand — not tied to one vehicle, unlike the
    per-vehicle Parts tab which tracks what's already installed. Set a
    quantity and a reorder threshold, +/- to adjust as you use or restock,
    and it surfaces in the same "Coming up" reminders as everything else
    once you're low or out.
  - Multi-currency support (dashboard, "Settings" panel): pick from 12
    common currencies and every cost across the whole garage — fleet
    stats, cost per mile, service/fuel/parts/insurance logs, the printable
    record — relabels immediately. Amounts already entered aren't
    converted, just displayed in the new currency's symbol and format.
    Building this also surfaced and fixed a real bug: cost-per-mile on the
    dashboard vehicle cards was always showing $0/mi (a rounding artifact
    in the old formatter) — it now shows the actual figure to the cent.
  - Spend Over Time (dashboard, "Spend Over Time" panel): a 12-month bar
    chart of maintenance + fuel + parts spend across the whole garage,
    hand-drawn as inline SVG (no charting library). Complements the
    per-vehicle lifetime total already on each vehicle's Cost tab with the
    "is this trending up" view across every vehicle at once. Hover any bar
    for the exact figure in that month.
  - Mileage check-ins (per vehicle header + dashboard reminders): every
    reminder in the app — service due, repair age, mileage pace — depends
    on the odometer figure being current, so Dipstick now tracks when it
    was last actually confirmed and asks again roughly twice a month
    (nudges at 15 days, marks overdue at 35) rather than letting a stale
    number quietly drive every other calculation. Typing a new figure into
    "Update odometer," or logging a service/fuel entry with a higher
    mileage than what's on file, both count as a fresh confirmation. The
    nudge shows on the vehicle page and rolls into the dashboard's existing
    "Coming up" reminder feed (and its opt-in browser notifications) the
    same as every other due item — no separate system to build or explain.
  - GPS-based odometer suggestion (per vehicle, "Trips" tab): since the
    Trips tab already measures distance by GPS for logged trips, it now
    sums what's been driven since your last confirmed reading and offers
    a one-click "Use this reading" update. This is a nudge, not a
    replacement for the real odometer — it only counts trips actually
    logged (foreground-only, tab has to be open — see the Trips tab's own
    disclaimer above), and GPS distance drifts a little from the true
    mechanical mileage, so it's offered as a suggestion to confirm, not an
    automatic overwrite.
  - Repair Age (per vehicle, new panel above the tabs): a car's condition
    age versus its calendar age — the model year everyone can see, next to
    a number built from what this specific vehicle has actually been
    through. Reads five signals already sitting in your own logs: service
    schedule adherence, OBD2 fault-code history, insurance claims, mileage
    pace against a 12,000 mi/yr baseline, and a fuel-efficiency trend —
    each one only counts once it has real data behind it, and with fewer
    than 3 of the 5 present the panel says so plainly instead of showing a
    number it can't back up. Nobody in the researched competitor set offers
    anything like it — this is Dipstick's own formula, not a copy of
    anyone's inspection checklist. Worth saying plainly: like everything
    else in a static site, the JavaScript that computes it can be read by
    anyone who opens dev tools — nothing server-side is hiding it. What
    makes it worth having isn't secrecy, it's that reproducing it means
    reproducing years of a specific car's real maintenance data, which
    nobody else has.

DELIBERATELY NOT BUILT (needs a live backend or a commercial data
partnership — out of scope for a static, no-server site; see the backlog
page)
  - Shop-quote marketplace / booking (Openbay) — needs a live backend
    matching real shops to real quotes
  - Fleet-scale compliance: dash cams, driver scoring, DOT inspections —
    wrong audience, not a hosting limitation
  - Auto-imported service history from a paid national database (CARFAX) —
    needs a commercial data partnership no static site can substitute for

FILES
  index.html      dashboard — reminders, fleet stats, vehicle list, backup
  vehicle.html    per-vehicle detail — service, fuel, parts/tires, docs,
                  warranty, cost of ownership, GPS trips, OBD2 diagnostics
  providers.html  shop/provider directory
  privacy.html    what data goes where (short version: nowhere but here)
  app.js          shared engine (all the math + storage)
  app.css         shared styles
  manifest.json / sw.js   installable PWA + offline + reminders
  icon-*.png, favicon.png  app icons (from your uploaded logo)

This is a first broad pass, built to be pruned. Nothing here is final.
