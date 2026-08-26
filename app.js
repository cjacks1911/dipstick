/**
 * DIPSTICK — shared module.
 *
 * A garage-only spin-off of the Garage engine built for HUSLLYFE: same proven
 * math for service schedules, due dates, VIN decoding and safety recalls,
 * carried over verbatim because it was already tested and it works. No
 * scoring lives here — this app doesn't grade you, it just remembers what
 * your car needs and tells you before it's a problem.
 *
 * No server, no account, no backend. Everything lives in localStorage on
 * this device. The only network calls this app ever makes are to NHTSA's
 * free public vehicle database (VIN decode + recalls) — optional, and never
 * required for anything else to work.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------
  // storage
  // ---------------------------------------------------------------------
  var STORAGE_KEY = 'dipstick.state.v1';
  var EXPORT_FORMAT = 1;
  var STORAGE_LIMIT_BYTES = 4.5 * 1024 * 1024; // conservative localStorage budget

  function freshState() {
    return { vehicles: [], providers: [], inventory: [], currency: 'USD', lastExportAt: null, setupDone: false };
  }
  var state = freshState();

  function hasLocalStorage() {
    try { var k = '__dipstick_test__'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; }
    catch (e) { return false; }
  }
  var HAS_LS = hasLocalStorage();

  function migrate(raw) {
    var s = Object.assign(freshState(), raw || {});
    s.vehicles = (s.vehicles || []).map(function (v) {
      return Object.assign({
        id: v.id, year: '', make: '', model: '', trim: '', vin: '', mileage: 0,
        purchasePrice: null, purchaseMileage: null, notes: '', duty: 'normal',
        intervals: {}, maintenance: [], fuel: [], documents: [], parts: [],
        tires: [], warranties: [], valuations: [], recalls: null, photos: [],
        trips: [], obdReadings: [], dtcEvents: [], insuranceClaims: [],
        mileageUpdatedAt: null,
        addedOn: todayKey()
      }, v);
    });
    s.providers = s.providers || [];
    s.inventory = s.inventory || [];
    s.currency = s.currency || 'USD';
    return s;
  }

  function loadState(callback) {
    try {
      var raw = HAS_LS ? localStorage.getItem(STORAGE_KEY) : null;
      state = raw ? migrate(JSON.parse(raw)) : freshState();
    } catch (e) { state = freshState(); }
    callback(state);
  }

  var saveTimer = null;
  function saveState() {
    return new Promise(function (resolve) {
      if (!HAS_LS) return resolve(false);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        publishDigest();
        resolve(true);
      } catch (e) { resolve(false); }
    });
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 250);
  }
  function resetState() {
    state = freshState();
    return saveState();
  }
  function getState() { return state; }

  function estimateBytes(obj) {
    try { return new Blob([JSON.stringify(obj)]).size; } catch (e) { return JSON.stringify(obj).length; }
  }

  // =======================================================================
  // theme — dark is Dipstick's native look; light is an explicit opt-in or
  // an OS-level preference. Nothing here decides colors, that's app.css —
  // this just tracks which the user picked and keeps <meta name=theme-color>
  // (the Android status-bar/task-switcher tint) in sync with it. The actual
  // no-flash-on-load work happens in a tiny inline script in each page's
  // <head>, which runs before this file has even loaded.
  // =======================================================================
  var THEME_KEY = 'dipstick.theme';
  var THEME_COLOR = { dark: '#0b0d10', light: '#f5f2ea' };

  function getThemeChoice() {
    try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { return 'system'; }
  }
  function systemPrefersLight() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches); }
    catch (e) { return false; }
  }
  function resolvedTheme() {
    var choice = getThemeChoice();
    if (choice === 'light' || choice === 'dark') return choice;
    return systemPrefersLight() ? 'light' : 'dark';
  }
  function syncThemeColorMeta() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[resolvedTheme()]);
  }
  /** name: 'light' | 'dark' | 'system'. Applies immediately and remembers it (or forgets it, for 'system'). */
  function setTheme(name) {
    try {
      if (name === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, name);
    } catch (e) {}
    if (name === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', name);
    syncThemeColorMeta();
  }
  /** Wires a button as the light/dark switch: click flips between the two, always landing on an explicit choice. */
  function initThemeToggle(btn) {
    syncThemeColorMeta();
    if (!btn) return;
    function render() {
      var live = resolvedTheme();
      btn.textContent = live === 'light' ? '🌙' : '☀️';
      var label = live === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }
    render();
    btn.addEventListener('click', function () {
      setTheme(resolvedTheme() === 'light' ? 'dark' : 'light');
      render();
    });
    try {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
        if (getThemeChoice() === 'system') { syncThemeColorMeta(); render(); }
      });
    } catch (e) {}
  }

  // ---------------------------------------------------------------------
  // small helpers
  // ---------------------------------------------------------------------
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayKey() { return dayKey(new Date()); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function daysBetween(fromYmd, toYmd) {
    var a = String(fromYmd).split('-'), b = String(toYmd).split('-');
    var d1 = Date.UTC(+a[0], +a[1] - 1, +a[2]);
    var d2 = Date.UTC(+b[0], +b[1] - 1, +b[2]);
    return Math.round((d2 - d1) / 86400000);
  }
  function dateAddMonths(ymd, months) {
    var parts = String(ymd).split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var targetMonth = d.getMonth() + months;
    var day = d.getDate();
    d.setDate(1); d.setMonth(targetMonth);
    var lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
    return dayKey(d);
  }
  function shiftDays(ymd, n) {
    var p = String(ymd).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + n);
    return dayKey(d);
  }
  var CURRENCIES = [
    { code: 'USD', label: 'US Dollar ($)' }, { code: 'EUR', label: 'Euro (€)' },
    { code: 'GBP', label: 'British Pound (£)' }, { code: 'CAD', label: 'Canadian Dollar (C$)' },
    { code: 'AUD', label: 'Australian Dollar (A$)' }, { code: 'NZD', label: 'New Zealand Dollar (NZ$)' },
    { code: 'JPY', label: 'Japanese Yen (¥)' }, { code: 'INR', label: 'Indian Rupee (₹)' },
    { code: 'MXN', label: 'Mexican Peso (Mex$)' }, { code: 'BRL', label: 'Brazilian Real (R$)' },
    { code: 'CHF', label: 'Swiss Franc (CHF)' }, { code: 'ZAR', label: 'South African Rand (R)' }
  ];
  function getCurrency() { return state.currency || 'USD'; }
  function setCurrency(code) {
    if (CURRENCIES.some(function (c) { return c.code === code; })) state.currency = code;
  }
  /** decimals: fraction digits to show (default 0 — whole-currency totals; pass 2 for per-mile rates). */
  function fmtMoney(n, decimals) {
    n = Number(n) || 0;
    decimals = decimals == null ? 0 : decimals;
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency', currency: getCurrency(),
        minimumFractionDigits: decimals, maximumFractionDigits: decimals
      }).format(n);
    } catch (e) {
      return '$' + n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
  }
  function fmtMiles(n) { return (Number(n) || 0).toLocaleString() + ' mi'; }
  function fmtDate(ymd) {
    if (!ymd) return '—';
    var p = String(ymd).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /** HTML-escape any user-typed value before it goes into innerHTML. */
  function escapeHtml(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function vehicleTitle(v) {
    var s = [v.year, v.make, v.model].filter(Boolean).join(' ');
    return s || 'Untitled vehicle';
  }
  function getVehicle(id) {
    return (state.vehicles || []).filter(function (v) { return String(v.id) === String(id); })[0] || null;
  }
  /**
   * Every place a real odometer figure enters the app — the header field,
   * a maintenance/fuel log's own mileage column, an accepted GPS-trip
   * suggestion — should funnel through here, so v.mileageUpdatedAt always
   * reflects when the number was actually last confirmed by a human. Every
   * reminder in the app (service due, repair age, mileage pace) reads off
   * v.mileage, so keeping that date honest is what makes the mileage
   * check-in nudge below mean anything.
   */
  function recordMileage(v, miles, asOfDate, force) {
    miles = Number(miles);
    if (!(miles >= 0)) return;
    asOfDate = asOfDate || todayKey();
    if (force || miles > (Number(v.mileage) || 0)) {
      v.mileage = miles;
      if (!v.mileageUpdatedAt || asOfDate >= v.mileageUpdatedAt) v.mileageUpdatedAt = asOfDate;
    } else if (!v.mileageUpdatedAt || asOfDate > v.mileageUpdatedAt) {
      // A logged figure that didn't raise the odometer (e.g. a backfilled
      // older service record) still isn't a fresh check-in unless its own
      // date is actually more recent than what we already have.
      v.mileageUpdatedAt = asOfDate;
    }
  }
  var MILEAGE_CHECKIN_SOON_DAYS = 15;
  var MILEAGE_CHECKIN_OVERDUE_DAYS = 35;
  /** Twice-a-month cadence: nudge for a fresh odometer reading once it's been a while. */
  function mileageCheckinStatus(v) {
    var last = v.mileageUpdatedAt;
    if (!last) return { status: 'soon', daysSince: null, lastUpdated: null };
    var days = daysBetween(last, todayKey());
    var status = days >= MILEAGE_CHECKIN_OVERDUE_DAYS ? 'overdue' : (days >= MILEAGE_CHECKIN_SOON_DAYS ? 'soon' : 'ok');
    return { status: status, daysSince: days, lastUpdated: last };
  }
  function addVehicle(v) {
    var row = Object.assign({
      id: uid(), year: '', make: '', model: '', trim: '', vin: '', mileage: 0,
      purchasePrice: null, purchaseMileage: null, notes: '', duty: 'normal',
      intervals: {}, maintenance: [], fuel: [], documents: [], parts: [],
      tires: [], warranties: [], valuations: [], recalls: null, photos: [],
      trips: [], obdReadings: [], dtcEvents: [], insuranceClaims: [],
      mileageUpdatedAt: null,
      addedOn: todayKey()
    }, v);
    // A mileage figure typed in at add-vehicle time is a real reading, same
    // as one entered later via "Update odometer" — count it as confirmed so
    // the check-in nudge doesn't fire the moment the vehicle is created.
    if (row.mileage > 0 && !row.mileageUpdatedAt) row.mileageUpdatedAt = todayKey();
    state.vehicles.push(row);
    return row;
  }
  function removeVehicle(id) {
    state.vehicles = (state.vehicles || []).filter(function (v) { return String(v.id) !== String(id); });
  }

  // =======================================================================
  // VIN decode + safety recalls — ported verbatim from the proven engine.
  // =======================================================================
  var VPIC_DECODE_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/';
  var RECALLS_URL     = 'https://api.nhtsa.gov/recalls/recallsByVehicle';
  var LOOKUP_TIMEOUT_MS = 9000;
  var VIN_CHARS = /^[A-HJ-NPR-Z0-9]{17}$/;
  var VIN_TRANSLIT = { A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9 };
  var VIN_WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
  var RECALL_STALE_DAYS = 30;

  function normalizeVin(raw) { return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function isValidVin(raw) {
    var vin = normalizeVin(raw);
    if (!VIN_CHARS.test(vin)) return false;
    var sum = 0;
    for (var i = 0; i < 17; i++) {
      var ch = vin.charAt(i);
      var val = /[0-9]/.test(ch) ? Number(ch) : VIN_TRANSLIT[ch];
      if (val === undefined) return false;
      sum += val * VIN_WEIGHTS[i];
    }
    var check = sum % 11;
    var expected = check === 10 ? 'X' : String(check);
    return vin.charAt(8) === expected;
  }
  function fetchJson(url) {
    if (typeof fetch !== 'function') return Promise.reject(new Error('offline'));
    var controller = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, LOOKUP_TIMEOUT_MS);
    var opts = controller ? { signal: controller.signal } : {};
    return fetch(url, opts).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('http_' + res.status);
      return res.json();
    }, function (err) { clearTimeout(timer); throw err; });
  }
  function firstNonEmpty() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  }
  function titleCase(s) {
    s = String(s || '');
    if (!s) return '';
    if (s === s.toUpperCase() && s.length > 3) {
      return s.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }
    return s;
  }
  function recallDateKey(s) {
    if (!s) return '';
    var m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return m[3] + '-' + m[1] + '-' + m[2];
    var d = new Date(s);
    return isNaN(d) ? '' : dayKey(d);
  }

  function decodeVin(rawVin) {
    var vin = normalizeVin(rawVin);
    if (vin.length !== 17) {
      return Promise.resolve({ ok: false, reason: 'length', message: 'A VIN is 17 characters. That one is ' + vin.length + '.' });
    }
    if (!VIN_CHARS.test(vin)) {
      return Promise.resolve({ ok: false, reason: 'charset', message: 'That VIN contains a letter no VIN uses — I, O and Q never appear.' });
    }
    var checkOk = isValidVin(vin);
    return fetchJson(VPIC_DECODE_URL + encodeURIComponent(vin) + '?format=json').then(function (data) {
      var r = (data && data.Results && data.Results[0]) || null;
      if (!r) return { ok: false, reason: 'empty', message: 'NHTSA returned nothing for that VIN.' };
      var vehicle = {
        vin: vin,
        year: firstNonEmpty(r.ModelYear),
        make: titleCase(firstNonEmpty(r.Make)),
        model: titleCase(firstNonEmpty(r.Model)),
        trim: firstNonEmpty(r.Trim, r.Series),
        engine: [firstNonEmpty(r.DisplacementL) ? Number(r.DisplacementL).toFixed(1) + 'L' : '',
                 firstNonEmpty(r.EngineCylinders) ? r.EngineCylinders + '-cyl' : '',
                 titleCase(firstNonEmpty(r.FuelTypePrimary))].filter(Boolean).join(' '),
        body: titleCase(firstNonEmpty(r.BodyClass)),
        drive: firstNonEmpty(r.DriveType)
      };
      var notes = [];
      if (!checkOk) notes.push('The check digit does not validate, so this VIN may be mistyped — NHTSA decoded what it could.');
      if (!vehicle.make && !vehicle.model) {
        return { ok: false, reason: 'unknown', vehicle: vehicle, notes: notes, message: 'NHTSA could not identify that VIN. Enter the details by hand.' };
      }
      return { ok: true, vehicle: vehicle, notes: notes, checkDigitValid: checkOk };
    });
  }

  function fetchRecalls(year, make, model) {
    var q = '?make=' + encodeURIComponent(String(make || '').trim()) +
            '&model=' + encodeURIComponent(String(model || '').trim()) +
            '&modelYear=' + encodeURIComponent(String(year || '').trim());
    return fetchJson(RECALLS_URL + q).then(function (data) {
      var rows = (data && (data.results || data.Results)) || [];
      return {
        checkedAt: new Date().toISOString(),
        query: { year: String(year || ''), make: String(make || ''), model: String(model || '') },
        count: rows.length,
        campaigns: rows.map(function (r) {
          return {
            id: firstNonEmpty(r.NHTSACampaignNumber), component: firstNonEmpty(r.Component),
            summary: firstNonEmpty(r.Summary), consequence: firstNonEmpty(r.Consequence),
            remedy: firstNonEmpty(r.Remedy), reported: recallDateKey(r.ReportReceivedDate),
            parkIt: !!r.parkIt, parkOutside: !!r.parkOutSide, overTheAir: !!r.overTheAirUpdate
          };
        })
      };
    });
  }
  function refreshRecalls(v) {
    if (!v) return Promise.reject(new Error('no_vehicle'));
    if (!v.year || !v.make || !v.model) return Promise.reject(new Error('need_year_make_model'));
    return fetchRecalls(v.year, v.make, v.model).then(function (rec) { v.recalls = rec; scheduleSave(); return rec; });
  }
  function recallStatus(v) {
    var r = v && v.recalls;
    if (!r) return { checked: false, count: 0, urgent: false };
    var days = daysBetween(dayKey(new Date(r.checkedAt)), todayKey());
    var urgent = (r.campaigns || []).some(function (c) { return c.parkIt || c.parkOutside; });
    return { checked: true, count: r.count || 0, urgent: urgent, days: days, stale: days >= RECALL_STALE_DAYS, campaigns: r.campaigns || [] };
  }

  // =======================================================================
  // service schedule — ported verbatim (make-specific intervals + generic
  // fallback + severe duty + due-date projection from fitted driving pace).
  // =======================================================================
  var SERVICE_SCHEDULE = [
    { type: 'Oil Change',    miles: 5000,  months: 6 },
    { type: 'Tire Rotation', miles: 6000,  months: 6 },
    { type: 'Air Filter',    miles: 15000, months: 12 },
    { type: 'Brake Service', miles: 25000, months: 36 },
    { type: 'Tune-Up',       miles: 30000, months: 24 },
    { type: 'Battery',       miles: 0,     months: 48 },
    { type: 'Inspection',    miles: 0,     months: 12 }
  ];
  /**
   * Suggestions offered in the "Log a Service" type field, on top of
   * whatever's in SERVICE_SCHEDULE. Deliberately NOT added to
   * SERVICE_SCHEDULE itself: those entries get a recurring mileage/month
   * interval and show up as "due" on a schedule, which fits an oil change
   * but not a one-off repair (a cracked hose, a failed sensor). "Repair"
   * stays selectable here without turning into a nag that expects the same
   * fix again on a fixed interval — serviceInterval() already leaves any
   * logged type with no schedule entry untracked (status 'off') unless the
   * owner deliberately sets an interval for it in the Service tab below.
   */
  var LOG_TYPE_SUGGESTIONS = SERVICE_SCHEDULE.map(function (s) { return s.type; }).concat(['Repair']);
  var SEVERE_DUTY_FACTOR = 0.7;
  var SOON_FRACTION = 0.10;
  var DEFAULT_MILES_PER_YEAR = 12000;
  var MIN_RATE_SPAN_DAYS = 21;

  var MAKE_INTERVALS = {
    porsche:    { label: 'Porsche',        i: { 'Oil Change': [10000, 12], 'Tire Rotation': [10000, 12], 'Air Filter': [30000, 36], 'Brake Service': [25000, 24], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    bmw:        { label: 'BMW',            i: { 'Oil Change': [10000, 12], 'Tire Rotation': [10000, 12], 'Air Filter': [30000, 36], 'Brake Service': [25000, 24], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    mercedes:   { label: 'Mercedes-Benz',  i: { 'Oil Change': [10000, 12], 'Tire Rotation': [10000, 12], 'Air Filter': [30000, 36], 'Brake Service': [25000, 24], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    audi:       { label: 'Audi',           i: { 'Oil Change': [10000, 12], 'Tire Rotation': [10000, 12], 'Air Filter': [30000, 36], 'Brake Service': [25000, 24], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    volkswagen: { label: 'Volkswagen',     i: { 'Oil Change': [10000, 12], 'Tire Rotation': [10000, 12], 'Air Filter': [30000, 36], 'Brake Service': [25000, 24], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    toyota:     { label: 'Toyota',         i: { 'Oil Change': [10000, 12], 'Tire Rotation': [5000, 6],   'Air Filter': [30000, 36], 'Brake Service': [25000, 36], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    lexus:      { label: 'Lexus',          i: { 'Oil Change': [10000, 12], 'Tire Rotation': [5000, 6],   'Air Filter': [30000, 36], 'Brake Service': [25000, 36], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    honda:      { label: 'Honda',          i: { 'Oil Change': [7500, 12],  'Tire Rotation': [7500, 12],  'Air Filter': [30000, 36], 'Brake Service': [25000, 36], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    acura:      { label: 'Acura',          i: { 'Oil Change': [7500, 12],  'Tire Rotation': [7500, 12],  'Air Filter': [30000, 36], 'Brake Service': [25000, 36], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    subaru:     { label: 'Subaru',         i: { 'Oil Change': [6000, 6],   'Tire Rotation': [6000, 6],   'Air Filter': [30000, 36], 'Brake Service': [25000, 36], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    mazda:      { label: 'Mazda',          i: { 'Oil Change': [7500, 12],  'Tire Rotation': [7500, 12],  'Air Filter': [30000, 36], 'Brake Service': [25000, 36], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    nissan:     { label: 'Nissan',         i: { 'Oil Change': [5000, 6],   'Tire Rotation': [5000, 6],   'Air Filter': [30000, 36], 'Brake Service': [25000, 36], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    ford:       { label: 'Ford',           i: { 'Oil Change': [7500, 12],  'Tire Rotation': [7500, 12],  'Air Filter': [30000, 36], 'Brake Service': [25000, 36], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    chevrolet:  { label: 'Chevrolet',      i: { 'Oil Change': [7500, 12],  'Tire Rotation': [7500, 12],  'Air Filter': [30000, 36], 'Brake Service': [25000, 36], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    gmc:        { label: 'GMC',            i: { 'Oil Change': [7500, 12],  'Tire Rotation': [7500, 12],  'Air Filter': [30000, 36], 'Brake Service': [25000, 36], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    jeep:       { label: 'Jeep',           i: { 'Oil Change': [8000, 12],  'Tire Rotation': [8000, 12],  'Air Filter': [30000, 36], 'Brake Service': [25000, 36], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    hyundai:    { label: 'Hyundai',        i: { 'Oil Change': [7500, 12],  'Tire Rotation': [7500, 12],  'Air Filter': [30000, 36], 'Brake Service': [25000, 36], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    kia:        { label: 'Kia',            i: { 'Oil Change': [7500, 12],  'Tire Rotation': [7500, 12],  'Air Filter': [30000, 36], 'Brake Service': [25000, 36], 'Battery': [0, 48], 'Inspection': [0, 12] } },
    tesla:      { label: 'Tesla (EV)',     ev: true, i: { 'Oil Change': [0, 0], 'Tune-Up': [0, 0], 'Tire Rotation': [6250, 12], 'Air Filter': [0, 24], 'Brake Service': [0, 24], 'Battery': [0, 0], 'Inspection': [0, 12] } },
    rivian:     { label: 'Rivian (EV)',    ev: true, i: { 'Oil Change': [0, 0], 'Tune-Up': [0, 0], 'Tire Rotation': [7500, 12], 'Air Filter': [0, 24], 'Brake Service': [0, 24], 'Battery': [0, 0], 'Inspection': [0, 12] } },
    polestar:   { label: 'Polestar (EV)',  ev: true, i: { 'Oil Change': [0, 0], 'Tune-Up': [0, 0], 'Tire Rotation': [7500, 12], 'Air Filter': [0, 24], 'Brake Service': [0, 24], 'Battery': [0, 0], 'Inspection': [0, 12] } }
  };
  var MAKE_ALIASES = { 'mercedes-benz': 'mercedes', 'mercedes benz': 'mercedes', 'benz': 'mercedes', 'vw': 'volkswagen', 'chevy': 'chevrolet' };

  function makeSchedule(v) {
    var raw = String((v && v.make) || '').trim().toLowerCase();
    if (!raw) return null;
    var key = MAKE_ALIASES[raw] || raw;
    return MAKE_INTERVALS[key] || null;
  }
  function makeScheduleLabel(v) { var m = makeSchedule(v); return m ? m.label : null; }
  function defaultInterval(type) {
    for (var i = 0; i < SERVICE_SCHEDULE.length; i++) {
      if (SERVICE_SCHEDULE[i].type.toLowerCase() === String(type).toLowerCase()) {
        return { miles: SERVICE_SCHEDULE[i].miles, months: SERVICE_SCHEDULE[i].months };
      }
    }
    return null;
  }
  function intervalSource(v, type) {
    var over = (v.intervals || {})[type];
    if (over && (over.miles != null || over.months != null)) return 'user';
    var m = makeSchedule(v);
    if (m && m.i[type]) return 'make';
    return 'generic';
  }
  function serviceInterval(v, type) {
    var over = (v.intervals || {})[type];
    var m = makeSchedule(v);
    var base = (m && m.i[type]) ? { miles: m.i[type][0], months: m.i[type][1] } : (defaultInterval(type) || { miles: 0, months: 0 });
    var miles  = over && over.miles  != null ? Number(over.miles)  : base.miles;
    var months = over && over.months != null ? Number(over.months) : base.months;
    if (v.duty === 'severe') { miles = Math.round(miles * SEVERE_DUTY_FACTOR); months = Math.round(months * SEVERE_DUTY_FACTOR); }
    return { miles: miles > 0 ? miles : 0, months: months > 0 ? months : 0, disabled: !(miles > 0) && !(months > 0) };
  }
  function serviceTypesFor(v) {
    var seen = {}, out = [];
    SERVICE_SCHEDULE.forEach(function (s) { seen[s.type.toLowerCase()] = true; out.push(s.type); });
    (v.maintenance || []).forEach(function (r) {
      var t = (r.type || '').trim();
      if (t && !seen[t.toLowerCase()]) { seen[t.toLowerCase()] = true; out.push(t); }
    });
    return out;
  }
  function lastServiceOf(v, type) {
    var t = String(type).toLowerCase();
    var rows = (v.maintenance || []).filter(function (r) { return String(r.type || '').toLowerCase() === t; });
    if (!rows.length) return null;
    rows.sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : -1; });
    return rows[0];
  }
  function mileageRate(v) {
    var fallback = { perDay: DEFAULT_MILES_PER_YEAR / 365, source: 'default' };
    var points = (v.maintenance || [])
      .filter(function (r) { return r.date && Number(r.mileage) > 0; })
      .map(function (r) { return { date: r.date, miles: Number(r.mileage) }; });
    if (Number(v.mileage) > 0) points.push({ date: todayKey(), miles: Number(v.mileage) });
    if (points.length < 2) return fallback;
    points.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    var clean = [], high = -Infinity;
    points.forEach(function (p) { if (p.miles >= high) { clean.push(p); high = p.miles; } });
    if (clean.length < 2) return fallback;
    var first = clean[0], last = clean[clean.length - 1];
    var span = daysBetween(first.date, last.date);
    var delta = last.miles - first.miles;
    if (span < MIN_RATE_SPAN_DAYS || delta <= 0) return fallback;
    return { perDay: delta / span, source: 'fitted', spanDays: span, miles: delta, points: clean.length };
  }
  function serviceDue(v, type) {
    var iv = serviceInterval(v, type);
    if (iv.disabled) return { type: type, status: 'off', interval: iv };
    var last = lastServiceOf(v, type);
    var out = { type: type, interval: iv, last: last };
    if (!last) { out.status = 'none'; return out; }
    var currentMiles = Number(v.mileage) || 0;
    var lastMiles = Number(last.mileage) || 0;
    if (iv.miles > 0) {
      out.dueAtMiles = lastMiles + iv.miles;
      out.remainingMiles = out.dueAtMiles - currentMiles;
    }
    if (iv.months > 0) {
      out.dueOn = dateAddMonths(last.date, iv.months);
      out.remainingDays = daysBetween(todayKey(), out.dueOn);
      var rate = mileageRate(v);
      out.projectedOn = out.remainingMiles != null && rate.perDay > 0
        ? shiftDays(todayKey(), Math.round(out.remainingMiles / rate.perDay)) : null;
      out.rateSource = rate.source;
    }
    var overdue = (out.remainingMiles != null && out.remainingMiles <= 0) || (out.remainingDays != null && out.remainingDays <= 0);
    var soon = !overdue && (
      (out.remainingMiles != null && iv.miles > 0 && out.remainingMiles <= iv.miles * SOON_FRACTION) ||
      (out.remainingDays != null && iv.months > 0 && out.remainingDays <= (iv.months * 30.4) * SOON_FRACTION)
    );
    out.status = overdue ? 'overdue' : (soon ? 'soon' : 'ok');
    return out;
  }
  function vehicleDueList(v) {
    return serviceTypesFor(v).map(function (t) { return serviceDue(v, t); }).filter(function (d) { return d.status !== 'off'; });
  }
  function topDue(v, n) {
    var rank = { overdue: 0, soon: 1, none: 2, ok: 3 };
    return vehicleDueList(v).sort(function (a, b) { return rank[a.status] - rank[b.status]; }).slice(0, n || 3);
  }
  /** Coverage: what fraction of the schedule has ANY logged history at all. */
  function maintenanceCoverage(v) {
    var list = vehicleDueList(v);
    if (!list.length) return { coverage: 0, tracked: 0, schedule: 0 };
    var tracked = list.filter(function (d) { return d.status !== 'none'; }).length;
    return { coverage: tracked / list.length, tracked: tracked, schedule: list.length };
  }

  // -- maintenance CRUD ----------------------------------------------------
  function addMaintenance(v, rec) {
    var row = { id: uid(), date: rec.date || todayKey(), type: rec.type || 'Other',
      mileage: Number(rec.mileage) || 0, cost: rec.cost === '' || rec.cost == null ? null : Number(rec.cost),
      notes: (rec.notes || '').slice(0, 500), providerId: rec.providerId || null, diy: !!rec.diy, photos: rec.photos || [] };
    v.maintenance.push(row);
    if (row.mileage > 0) recordMileage(v, row.mileage, row.date);
    return row;
  }
  function removeMaintenance(v, id) { v.maintenance = (v.maintenance || []).filter(function (r) { return r.id !== id; }); }

  // =======================================================================
  // fuel log — real-world MPG / efficiency, the way Fuelly/Drivvo do it.
  // =======================================================================
  function addFuelEntry(v, e) {
    var row = { id: uid(), date: e.date || todayKey(), mileage: Number(e.mileage) || 0,
      gallons: e.gallons ? Number(e.gallons) : null, kwh: e.kwh ? Number(e.kwh) : null,
      price: e.price ? Number(e.price) : null, full: e.full !== false, notes: (e.notes || '').slice(0, 300) };
    v.fuel.push(row);
    if (row.mileage > 0) recordMileage(v, row.mileage, row.date);
    return row;
  }
  function removeFuelEntry(v, id) { v.fuel = (v.fuel || []).filter(function (r) { return r.id !== id; }); }
  function fuelEntries(v) { return (v.fuel || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }); }
  /** MPG (or mi/kWh for an EV) between consecutive FULL fill-ups only — partial fills can't be measured. */
  function fuelStats(v) {
    var rows = (v.fuel || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var isEV = rows.some(function (r) { return r.kwh > 0; }) && !rows.some(function (r) { return r.gallons > 0; });
    var fulls = rows.filter(function (r) { return r.full; });
    var legs = [];
    for (var i = 1; i < fulls.length; i++) {
      var miles = Number(fulls[i].mileage) - Number(fulls[i - 1].mileage);
      var used = isEV ? Number(fulls[i].kwh) : Number(fulls[i].gallons);
      if (miles > 0 && used > 0) legs.push(miles / used);
    }
    var avg = legs.length ? legs.reduce(function (a, b) { return a + b; }, 0) / legs.length : null;
    var last = legs.length ? legs[legs.length - 1] : null;
    var totalSpend = rows.reduce(function (a, r) { return a + (Number(r.price) || 0); }, 0);
    return { isEV: isEV, avg: avg, last: last, legs: legs.length, totalSpend: totalSpend, unit: isEV ? 'mi/kWh' : 'MPG', entries: rows.length };
  }
  /**
   * Is fuel economy trending down over time? Same fill-to-fill pairing as
   * fuelStats(), but keeps each leg's date so early legs can be compared
   * against recent ones. Needs at least 4 measurable legs to say anything —
   * two data points either side isn't a trend, it's noise.
   */
  function fuelEfficiencyTrend(v) {
    var rows = (v.fuel || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var isEV = rows.some(function (r) { return r.kwh > 0; }) && !rows.some(function (r) { return r.gallons > 0; });
    var fulls = rows.filter(function (r) { return r.full; });
    var legs = [];
    for (var i = 1; i < fulls.length; i++) {
      var miles = Number(fulls[i].mileage) - Number(fulls[i - 1].mileage);
      var used = isEV ? Number(fulls[i].kwh) : Number(fulls[i].gallons);
      if (miles > 0 && used > 0) legs.push({ date: fulls[i].date, mpg: miles / used });
    }
    if (legs.length < 4) return null;
    var mid = Math.floor(legs.length / 2);
    var avg = function (arr) { return arr.reduce(function (a, l) { return a + l.mpg; }, 0) / arr.length; };
    var earlyAvg = avg(legs.slice(0, mid));
    var recentAvg = avg(legs.slice(mid));
    if (!(earlyAvg > 0)) return null;
    var pctChange = (recentAvg - earlyAvg) / earlyAvg;
    var delta = 0;
    if (pctChange < -0.05) delta = Math.min(1.5, Math.abs(pctChange) * 6);
    else if (pctChange > 0.05) delta = Math.max(-1, -pctChange * 4);
    var detail = pctChange < -0.03
      ? 'Down ' + Math.round(Math.abs(pctChange) * 100) + '% from earlier fill-ups'
      : (pctChange > 0.03 ? 'Up ' + Math.round(pctChange * 100) + '% from earlier fill-ups' : 'Holding steady vs. earlier fill-ups');
    return { delta: delta, detail: detail, pctChange: pctChange, unit: isEV ? 'mi/kWh' : 'MPG' };
  }

  // =======================================================================
  // documents, warranties, parts & tires — all variants of "this expires,
  // tell me before it does", so they share one status calculation.
  // =======================================================================
  function expiryStatus(exp, currentMileage) {
    if (!exp.expiresOn && !exp.expiresMileage) return { status: 'untracked' };
    var rank = { overdue: 0, soon: 1, ok: 2 };
    var dayStatus = null, mileStatus = null, remainingDays = null, remainingMiles = null;
    if (exp.expiresOn) {
      remainingDays = daysBetween(todayKey(), exp.expiresOn);
      dayStatus = remainingDays < 0 ? 'overdue' : (remainingDays <= 30 ? 'soon' : 'ok');
    }
    if (exp.expiresMileage && currentMileage > 0) {
      remainingMiles = exp.expiresMileage - currentMileage;
      mileStatus = remainingMiles < 0 ? 'overdue' : (remainingMiles <= 500 ? 'soon' : 'ok');
    }
    var candidates = [dayStatus, mileStatus].filter(Boolean);
    var status = candidates.length ? candidates.reduce(function (a, b) { return rank[a] <= rank[b] ? a : b; }) : 'ok';
    return { status: status, remainingDays: remainingDays, remainingMiles: remainingMiles };
  }

  function addDocument(v, d) {
    var row = { id: uid(), name: (d.name || 'Document').slice(0, 80), category: d.category || 'other',
      dataUrl: d.dataUrl || null, expiresOn: d.expiresOn || null, addedOn: todayKey(), notes: (d.notes || '').slice(0, 300) };
    v.documents.push(row);
    return row;
  }
  function removeDocument(v, id) { v.documents = (v.documents || []).filter(function (r) { return r.id !== id; }); }
  function documentStatus(d) { return expiryStatus({ expiresOn: d.expiresOn }, null); }

  function addWarranty(v, w) {
    var row = { id: uid(), name: (w.name || 'Warranty').slice(0, 80), provider: (w.provider || '').slice(0, 80),
      expiresOn: w.expiresOn || null, expiresMileage: w.expiresMileage ? Number(w.expiresMileage) : null,
      cost: w.cost ? Number(w.cost) : null, notes: (w.notes || '').slice(0, 300) };
    v.warranties.push(row);
    return row;
  }
  function removeWarranty(v, id) { v.warranties = (v.warranties || []).filter(function (r) { return r.id !== id; }); }
  function warrantyStatus(w, v) { return expiryStatus(w, Number(v.mileage) || 0); }

  function addPart(v, p) {
    var row = { id: uid(), name: (p.name || 'Part').slice(0, 80), category: p.category || 'other',
      brand: (p.brand || '').slice(0, 60), installedDate: p.installedDate || todayKey(),
      installedMileage: Number(p.installedMileage) || Number(v.mileage) || 0,
      cost: p.cost ? Number(p.cost) : null, expectedLifeMiles: p.expectedLifeMiles ? Number(p.expectedLifeMiles) : null,
      expectedLifeMonths: p.expectedLifeMonths ? Number(p.expectedLifeMonths) : null, notes: (p.notes || '').slice(0, 300) };
    v.parts.push(row);
    return row;
  }
  function removePart(v, id) { v.parts = (v.parts || []).filter(function (r) { return r.id !== id; }); }
  function partStatus(p, v) {
    var exp = {
      expiresOn: p.expectedLifeMonths ? dateAddMonths(p.installedDate, p.expectedLifeMonths) : null,
      expiresMileage: p.expectedLifeMiles ? p.installedMileage + p.expectedLifeMiles : null
    };
    return expiryStatus(exp, Number(v.mileage) || 0);
  }

  function addTire(v, t) {
    var row = { id: uid(), position: t.position || 'Full set', brand: (t.brand || '').slice(0, 60),
      installedDate: t.installedDate || todayKey(), installedMileage: Number(t.installedMileage) || Number(v.mileage) || 0,
      notes: (t.notes || '').slice(0, 300), treadLog: [] };
    v.tires.push(row);
    return row;
  }
  function removeTire(v, id) { v.tires = (v.tires || []).filter(function (r) { return r.id !== id; }); }
  function addTreadReading(t, date, depth32) { t.treadLog.push({ date: date || todayKey(), depth: Number(depth32) }); }
  function tireWearStatus(t) {
    var log = (t.treadLog || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    if (!log.length) return { status: 'untracked', depth: null };
    var depth = log[0].depth;
    var status = depth <= 2 ? 'overdue' : (depth <= 4 ? 'soon' : 'ok');
    return { status: status, depth: depth, lastChecked: log[0].date };
  }

  // =======================================================================
  // insurance claims — a plain log, deliberately separate from routine
  // maintenance: an accident, a claim filed, what it cost and what came
  // back. No due-date math here (a claim isn't something that "expires"),
  // just a record with a status you update as it moves.
  // =======================================================================
  var CLAIM_CATEGORIES = ['accident', 'theft', 'glass', 'weather', 'liability', 'other'];
  var CLAIM_STATUSES = ['filed', 'approved', 'denied', 'closed'];
  function addInsuranceClaim(v, c) {
    var row = {
      id: uid(), date: c.date || todayKey(),
      category: CLAIM_CATEGORIES.indexOf(c.category) > -1 ? c.category : 'other',
      description: (c.description || '').slice(0, 300), insurer: (c.insurer || '').slice(0, 80),
      claimedAmount: c.claimedAmount ? Number(c.claimedAmount) : null,
      deductible: c.deductible ? Number(c.deductible) : null,
      paidAmount: c.paidAmount ? Number(c.paidAmount) : null,
      status: CLAIM_STATUSES.indexOf(c.status) > -1 ? c.status : 'filed',
      notes: (c.notes || '').slice(0, 300)
    };
    v.insuranceClaims.push(row);
    return row;
  }
  function removeInsuranceClaim(v, id) { v.insuranceClaims = (v.insuranceClaims || []).filter(function (r) { return r.id !== id; }); }
  function updateInsuranceClaim(v, id, patch) {
    var row = (v.insuranceClaims || []).filter(function (r) { return r.id === id; })[0];
    if (!row) return null;
    if (patch.status && CLAIM_STATUSES.indexOf(patch.status) > -1) row.status = patch.status;
    if (patch.paidAmount !== undefined) row.paidAmount = patch.paidAmount ? Number(patch.paidAmount) : null;
    return row;
  }

  // =======================================================================
  // GPS trip logging — unlocked by moving off file:// onto real HTTPS
  // hosting: the Geolocation API refuses to run in an insecure context, so
  // this was a dead end until now. Still foreground-only by design of the
  // web platform itself — no browser lets a site track location once the
  // tab is closed, hosted or not, so this logs trips you start and stop
  // while Dipstick is open, not silent always-on tracking like a native app.
  // =======================================================================
  var TRIP_SAMPLE_MIN_MS = 4000;      // don't keep a path point more often than this
  var TRIP_SAMPLE_MIN_METERS = 15;    // ...or closer together than this
  var TRIP_MAX_PATH_POINTS = 2000;    // hard cap so a long trip can't blow the storage budget
  var activeTrip = null;              // { watchId, startedAt, points: [{lat,lng,t}] }

  function gpsSupport() {
    return { available: typeof navigator !== 'undefined' && !!navigator.geolocation && (window.isSecureContext !== false) };
  }
  /** Great-circle distance in miles between two lat/lng points. */
  function haversineMiles(lat1, lon1, lat2, lon2) {
    var R = 3958.8;
    var toRad = function (d) { return d * Math.PI / 180; };
    var dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }
  function tripPathDistanceMiles(points) {
    var total = 0;
    for (var i = 1; i < points.length; i++) {
      total += haversineMiles(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    }
    return total;
  }
  function startTrip(onUpdate) {
    if (!gpsSupport().available) return { ok: false, message: 'This browser (or this connection) cannot use location.' };
    if (activeTrip) return { ok: false, message: 'A trip is already running.' };
    var points = [];
    var watchId = navigator.geolocation.watchPosition(function (pos) {
      var p = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now() };
      var last = points[points.length - 1];
      var keep = !last
        || (p.t - last.t >= TRIP_SAMPLE_MIN_MS && haversineMiles(last.lat, last.lng, p.lat, p.lng) * 1609.34 >= TRIP_SAMPLE_MIN_METERS);
      if (keep && points.length < TRIP_MAX_PATH_POINTS) points.push(p);
      if (typeof onUpdate === 'function') {
        onUpdate({ points: points.length, distanceMiles: tripPathDistanceMiles(points), elapsedMs: Date.now() - activeTrip.startedAt });
      }
    }, function (err) {
      if (typeof onUpdate === 'function') onUpdate({ error: err && err.message ? err.message : 'Location error' });
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
    activeTrip = { watchId: watchId, startedAt: Date.now(), points: points };
    return { ok: true };
  }
  function activeTripSnapshot() {
    if (!activeTrip) return null;
    return { points: activeTrip.points.length, distanceMiles: tripPathDistanceMiles(activeTrip.points), elapsedMs: Date.now() - activeTrip.startedAt };
  }
  function isTripActive() { return !!activeTrip; }
  /** Stop the active trip and save it onto vehicle v. Returns the saved trip, or null if there was nothing running. */
  function stopTrip(v, extra) {
    if (!activeTrip) return null;
    navigator.geolocation.clearWatch(activeTrip.watchId);
    var points = activeTrip.points;
    var durationSec = Math.round((Date.now() - activeTrip.startedAt) / 1000);
    var distanceMiles = tripPathDistanceMiles(points);
    activeTrip = null;
    var row = Object.assign({
      id: uid(), date: todayKey(), startedAt: new Date(Date.now() - durationSec * 1000).toISOString(),
      durationSec: durationSec, distanceMiles: distanceMiles,
      avgMph: durationSec > 0 ? distanceMiles / (durationSec / 3600) : 0,
      purpose: '', notes: '', path: points
    }, extra || {});
    v.trips = v.trips || [];
    v.trips.push(row);
    return row;
  }
  function discardActiveTrip() {
    if (!activeTrip) return;
    navigator.geolocation.clearWatch(activeTrip.watchId);
    activeTrip = null;
  }
  function removeTrip(v, id) { v.trips = (v.trips || []).filter(function (t) { return t.id !== id; }); }
  function tripStats(v) {
    var trips = v.trips || [];
    var totalMiles = trips.reduce(function (a, t) { return a + (t.distanceMiles || 0); }, 0);
    var totalSec = trips.reduce(function (a, t) { return a + (t.durationSec || 0); }, 0);
    return { count: trips.length, totalMiles: totalMiles, totalSec: totalSec,
      avgMph: totalSec > 0 ? totalMiles / (totalSec / 3600) : 0 };
  }
  /**
   * Not a replacement for the real odometer (GPS drifts, and trip logging
   * only runs while the tab is open — see the Trips tab's own disclaimer),
   * but a genuinely useful nudge: sum the trips logged since the odometer
   * was last confirmed and offer that as a one-click update, so the figure
   * every reminder in the app depends on doesn't go stale between visits.
   */
  function suggestedMileage(v) {
    var base = Number(v.mileage) || 0;
    var since = v.mileageUpdatedAt;
    var trips = (v.trips || []).filter(function (t) {
      var d = t.date || (t.startedAt || '').slice(0, 10);
      return !since || d > since;
    });
    var added = trips.reduce(function (a, t) { return a + (Number(t.distanceMiles) || 0); }, 0);
    if (!(added > 0.5)) return null;
    return { current: base, suggested: Math.round(base + added), addedMiles: round1(added), tripCount: trips.length };
  }
  /**
   * A lightweight route sketch — not a map (no tiles, no API key, nothing to
   * pay for or configure), just the shape of the path scaled to fit a small
   * SVG box. Returns an array of [x,y] pairs ready to join into a <polyline>.
   */
  function tripRoutePoints(path, w, h, pad) {
    if (!path || path.length < 2) return [];
    pad = pad == null ? 6 : pad;
    var lats = path.map(function (p) { return p.lat; }), lngs = path.map(function (p) { return p.lng; });
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    var minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
    var spanLat = (maxLat - minLat) || 0.0001, spanLng = (maxLng - minLng) || 0.0001;
    return path.map(function (p) {
      var x = pad + ((p.lng - minLng) / spanLng) * (w - pad * 2);
      var y = pad + (1 - (p.lat - minLat) / spanLat) * (h - pad * 2); // flip: north = up
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    });
  }

  // =======================================================================
  // OBD2 diagnostics — the other feature the same HTTPS move unlocks: the
  // Web Bluetooth API also refuses to run outside a secure context. Real
  // limits worth being upfront about: Web Bluetooth only reaches Bluetooth
  // LOW ENERGY devices, and only in Chrome/Edge (desktop or Android) — never
  // Safari or iOS, in any browser, at all. Most of the classic $10 ELM327
  // dongles (the ones FIXD-style ads show) use Bluetooth CLASSIC (SPP) and
  // are invisible to any website, full stop. This works with the smaller set
  // of BLE-based adapters (Vgate iCar Pro BLE, OBDLink CX/MX+, Kiwi 3, and
  // other clones built on the same two common BLE-serial chipsets).
  // =======================================================================
  var BLE_UART_PROFILES = [
    { name: 'Nordic UART', service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', write: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', notify: '6e400003-b5a3-f393-e0a9-e50e24dcca9e' },
    { name: 'HM-10/FFE0',  service: '0000ffe0-0000-1000-8000-00805f9b34fb', write: '0000ffe1-0000-1000-8000-00805f9b34fb', notify: '0000ffe1-0000-1000-8000-00805f9b34fb' }
  ];
  var OBD_COMMAND_TIMEOUT_MS = 4500;
  var obdLink = null; // { device, server, writeChar, notifyChar, buffer, waiters: [] }

  function obdSupport() {
    return { available: typeof navigator !== 'undefined' && !!navigator.bluetooth && (window.isSecureContext !== false) };
  }
  function obdConnected() { return !!(obdLink && obdLink.device && obdLink.device.gatt && obdLink.device.gatt.connected); }

  function obdHandleNotify(event) {
    if (!obdLink) return;
    var chunk = new TextDecoder().decode(event.target.value);
    obdLink.buffer += chunk;
    if (obdLink.buffer.indexOf('>') === -1) return;
    var raw = obdLink.buffer;
    obdLink.buffer = '';
    var waiter = obdLink.waiters.shift();
    if (waiter) waiter.resolve(raw);
  }
  function obdSendRaw(cmd) {
    if (!obdConnected()) return Promise.reject(new Error('not_connected'));
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        obdLink.waiters = obdLink.waiters.filter(function (w) { return w.resolve !== resolve; });
        reject(new Error('timeout'));
      }, OBD_COMMAND_TIMEOUT_MS);
      obdLink.waiters.push({ resolve: function (raw) { clearTimeout(timer); resolve(raw); } });
      var bytes = new TextEncoder().encode(cmd + '\r');
      var writeFn = obdLink.writeChar.writeValueWithoutResponse
        ? obdLink.writeChar.writeValueWithoutResponse(bytes)
        : obdLink.writeChar.writeValue(bytes);
      Promise.resolve(writeFn).catch(function (e) { clearTimeout(timer); reject(e); });
    }).then(function (raw) {
      return raw.replace(/[\r\n]+/g, '\n').split('\n').map(function (s) { return s.trim(); })
        .filter(function (s) { return s && s !== '>' && s.toUpperCase() !== 'OK'; }).join(' ').replace(/>/g, '').trim();
    });
  }
  function obdConnect() {
    if (!obdSupport().available) {
      return Promise.resolve({ ok: false, reason: 'unsupported',
        message: 'This browser can’t talk to Bluetooth devices. Try Chrome or Edge on desktop or Android.' });
    }
    var allServices = BLE_UART_PROFILES.map(function (p) { return p.service; });
    return navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: allServices })
      .then(function (device) {
        return device.gatt.connect().then(function (server) {
          function tryProfile(i) {
            if (i >= BLE_UART_PROFILES.length) return Promise.reject(new Error('no_known_service'));
            var prof = BLE_UART_PROFILES[i];
            return server.getPrimaryService(prof.service).then(function (svc) {
              return Promise.all([svc.getCharacteristic(prof.write), svc.getCharacteristic(prof.notify)]);
            }).then(function (chars) {
              return { profile: prof, writeChar: chars[0], notifyChar: chars[1] };
            }).catch(function () { return tryProfile(i + 1); });
          }
          return tryProfile(0).then(function (found) {
            obdLink = { device: device, server: server, writeChar: found.writeChar, notifyChar: found.notifyChar, buffer: '', waiters: [] };
            found.notifyChar.addEventListener('characteristicvaluechanged', obdHandleNotify);
            return found.notifyChar.startNotifications();
          }).then(function () {
            // ELM327 init: reset, echo off, linefeeds off, headers off, auto protocol.
            return obdSendRaw('ATZ').catch(function () {})
              .then(function () { return obdSendRaw('ATE0'); }).catch(function () {})
              .then(function () { return obdSendRaw('ATL0'); }).catch(function () {})
              .then(function () { return obdSendRaw('ATH0'); }).catch(function () {})
              .then(function () { return obdSendRaw('ATSP0'); }).catch(function () {})
              .then(function () { return obdSendRaw('0100'); });
          }).then(function (probe) {
            device.addEventListener('gattserverdisconnected', function () { obdLink = null; });
            return { ok: true, name: device.name || 'OBD2 adapter', probe: probe };
          });
        });
      }, function (err) {
        return { ok: false, reason: 'cancelled', message: err && err.name === 'NotFoundError'
          ? 'No device selected.' : 'Could not open the Bluetooth chooser here.' };
      })
      .catch(function (err) {
        return { ok: false, reason: 'protocol', message: (obdLink === null)
          ? 'Connected, but it doesn’t look like a supported OBD2 adapter (no known serial service found). This works with BLE adapters only — most classic $10 ELM327 dongles use Bluetooth Classic, which the browser can’t reach.'
          : 'Connected, but it didn’t respond like an ELM327 adapter.' };
      });
  }
  function obdDisconnect() {
    if (obdLink && obdLink.device && obdLink.device.gatt) { try { obdLink.device.gatt.disconnect(); } catch (e) {} }
    obdLink = null;
  }
  /** Data bytes only, past the "41 <PID>" echo every mode-01 response leads with. */
  function obdParsePidBytes(resp) {
    var tokens = String(resp).trim().toUpperCase().split(/\s+/);
    var modeIdx = tokens.indexOf('41');
    if (modeIdx === -1) return [];
    return tokens.slice(modeIdx + 2).map(function (h) { return parseInt(h, 16); }).filter(function (n) { return !isNaN(n); });
  }
  /** One live snapshot: RPM, speed (mph), coolant temp (°F), fuel level (%) — whichever PIDs the ECU answers. */
  function obdReadLive() {
    if (!obdConnected()) return Promise.reject(new Error('not_connected'));
    var out = {};
    return obdSendRaw('010C').then(function (r) {
      if (/41\s*0C/i.test(r)) { var b = obdParsePidBytes(r); if (b.length >= 2) out.rpm = Math.round(((b[0] * 256) + b[1]) / 4); }
    }).catch(function () {})
      .then(function () { return obdSendRaw('010D'); }).then(function (r) {
        if (/41\s*0D/i.test(r)) { var b = obdParsePidBytes(r); if (b.length >= 1) out.speedMph = Math.round(b[0] * 0.621371); }
      }).catch(function () {})
      .then(function () { return obdSendRaw('0105'); }).then(function (r) {
        if (/41\s*05/i.test(r)) { var b = obdParsePidBytes(r); if (b.length >= 1) out.coolantF = Math.round((b[0] - 40) * 9 / 5 + 32); }
      }).catch(function () {})
      .then(function () { return obdSendRaw('012F'); }).then(function (r) {
        if (/41\s*2F/i.test(r)) { var b = obdParsePidBytes(r); if (b.length >= 1) out.fuelPct = Math.round(b[0] * 100 / 255); }
      }).catch(function () {})
      .then(function () { out.at = new Date().toISOString(); return out; });
  }
  /** Decode a 2-byte DTC (e.g. 01 33 -> P0133) per the standard SAE/ISO scheme. */
  function decodeDtcBytes(b1, b2) {
    if (b1 === 0 && b2 === 0) return null;
    var letters = ['P', 'C', 'B', 'U'];
    var letter = letters[(b1 >> 6) & 0x3];
    var digit1 = (b1 >> 4) & 0x3;
    var digit2 = (b1 & 0xF).toString(16).toUpperCase();
    var digit3 = ((b2 >> 4) & 0xF).toString(16).toUpperCase();
    var digit4 = (b2 & 0xF).toString(16).toUpperCase();
    return letter + digit1 + digit2 + digit3 + digit4;
  }
  function obdReadDTCs() {
    if (!obdConnected()) return Promise.reject(new Error('not_connected'));
    return obdSendRaw('03').then(function (resp) {
      var tokens = String(resp).trim().toUpperCase().split(/\s+/).filter(Boolean);
      var modeIdx = tokens.indexOf('43');
      var data = modeIdx === -1 ? tokens : tokens.slice(modeIdx + 1);
      var codes = [];
      for (var i = 0; i + 1 < data.length; i += 2) {
        var b1 = parseInt(data[i], 16), b2 = parseInt(data[i + 1], 16);
        if (isNaN(b1) || isNaN(b2)) continue;
        var code = decodeDtcBytes(b1, b2);
        if (code) codes.push({ code: code, description: OBD_DTC_DICTIONARY[code] || null });
      }
      return codes;
    });
  }
  function obdClearDTCs() {
    if (!obdConnected()) return Promise.reject(new Error('not_connected'));
    return obdSendRaw('04').then(function (resp) { return !/7F|NO DATA/i.test(resp); });
  }
  function addObdReading(v, reading) { v.obdReadings = v.obdReadings || []; v.obdReadings.push(reading); if (v.obdReadings.length > 200) v.obdReadings.shift(); }
  function addDtcEvent(v, event) { v.dtcEvents = v.dtcEvents || []; v.dtcEvents.unshift(event); }

  /** Common generic (SAE) powertrain codes — the ones that show up across most makes. Not exhaustive: an unrecognized code just shows its raw value. */
  var OBD_DTC_DICTIONARY = {
    P0100: 'Mass air flow circuit malfunction', P0101: 'Mass air flow circuit range/performance',
    P0110: 'Intake air temperature circuit malfunction', P0115: 'Engine coolant temperature circuit malfunction',
    P0116: 'Engine coolant temperature circuit range/performance', P0120: 'Throttle position sensor circuit malfunction',
    P0125: 'Insufficient coolant temperature for closed loop fuel control', P0128: 'Coolant thermostat below regulating temperature',
    P0130: 'O2 sensor circuit malfunction (Bank 1 Sensor 1)', P0133: 'O2 sensor circuit slow response (Bank 1 Sensor 1)',
    P0135: 'O2 sensor heater circuit malfunction (Bank 1 Sensor 1)', P0141: 'O2 sensor heater circuit malfunction (Bank 1 Sensor 2)',
    P0171: 'System too lean (Bank 1)', P0172: 'System too rich (Bank 1)',
    P0174: 'System too lean (Bank 2)', P0175: 'System too rich (Bank 2)',
    P0300: 'Random/multiple cylinder misfire detected', P0301: 'Cylinder 1 misfire detected',
    P0302: 'Cylinder 2 misfire detected', P0303: 'Cylinder 3 misfire detected', P0304: 'Cylinder 4 misfire detected',
    P0325: 'Knock sensor circuit malfunction', P0330: 'Knock sensor circuit malfunction (Bank 2)',
    P0335: 'Crankshaft position sensor circuit malfunction', P0340: 'Camshaft position sensor circuit malfunction',
    P0400: 'Exhaust gas recirculation flow malfunction', P0401: 'EGR flow insufficient detected',
    P0420: 'Catalyst system efficiency below threshold (Bank 1)', P0430: 'Catalyst system efficiency below threshold (Bank 2)',
    P0440: 'Evaporative emission system malfunction', P0441: 'EVAP incorrect purge flow',
    P0442: 'EVAP system leak detected (small leak)', P0446: 'EVAP vent control circuit malfunction',
    P0455: 'EVAP system leak detected (large leak)', P0456: 'EVAP system leak detected (very small leak)',
    P0500: 'Vehicle speed sensor malfunction', P0505: 'Idle control system malfunction',
    P0562: 'System voltage low', P0563: 'System voltage high',
    P0601: 'Internal control module memory checksum error', P0606: 'ECM/PCM processor malfunction',
    P0700: 'Transmission control system malfunction (see transmission codes)', P0705: 'Transmission range sensor circuit malfunction',
    P0715: 'Input/turbine speed sensor circuit malfunction', P0720: 'Output speed sensor circuit malfunction',
    P0740: 'Torque converter clutch circuit malfunction'
  };

  // =======================================================================
  // service providers — a shared directory, referenced by maintenance rows.
  // =======================================================================
  function addProvider(p) {
    var row = { id: uid(), name: (p.name || 'Shop').slice(0, 80), phone: (p.phone || '').slice(0, 40),
      address: (p.address || '').slice(0, 160), tags: p.tags || [], notes: (p.notes || '').slice(0, 300), addedOn: todayKey() };
    state.providers.push(row);
    return row;
  }
  function updateProvider(id, patch) {
    var p = getProvider(id);
    if (p) Object.assign(p, patch);
    return p;
  }
  function getProvider(id) { return (state.providers || []).filter(function (p) { return p.id === id; })[0] || null; }
  function removeProvider(id) { state.providers = (state.providers || []).filter(function (p) { return p.id !== id; }); }
  function providerUsage(id) {
    var out = [];
    (state.vehicles || []).forEach(function (v) {
      (v.maintenance || []).forEach(function (r) {
        if (r.providerId === id) out.push({ vehicle: v, record: r });
      });
    });
    return out.sort(function (a, b) { return a.record.date < b.record.date ? 1 : -1; });
  }

  // =======================================================================
  // parts inventory — what's on the shelf, garage-wide, deliberately not
  // per-vehicle: a spare filter doesn't belong to a car until it's
  // installed. Separate from the per-vehicle Parts tab, which tracks a part
  // already on a vehicle and when it'll wear out; this tracks stock so you
  // reorder before you run out, not the lifecycle of an installed part.
  // =======================================================================
  function addInventoryItem(item) {
    var row = {
      id: uid(), name: (item.name || 'Part').slice(0, 80),
      quantity: Math.max(0, Number(item.quantity) || 0),
      reorderThreshold: item.reorderThreshold != null && item.reorderThreshold !== '' ? Math.max(0, Number(item.reorderThreshold)) : 1,
      notes: (item.notes || '').slice(0, 300), addedOn: todayKey()
    };
    state.inventory.push(row);
    return row;
  }
  function getInventoryItem(id) { return (state.inventory || []).filter(function (r) { return r.id === id; })[0] || null; }
  function removeInventoryItem(id) { state.inventory = (state.inventory || []).filter(function (r) { return r.id !== id; }); }
  function adjustInventoryQty(id, delta) {
    var item = getInventoryItem(id);
    if (!item) return null;
    item.quantity = Math.max(0, (Number(item.quantity) || 0) + delta);
    return item;
  }
  function inventoryStatus(item) {
    var q = Number(item.quantity) || 0, t = Number(item.reorderThreshold) || 0;
    if (q <= 0) return { status: 'overdue', quantity: q };
    if (q <= t) return { status: 'soon', quantity: q };
    return { status: 'ok', quantity: q };
  }

  // =======================================================================
  // valuations + true cost of ownership (depreciation + every logged dollar)
  // =======================================================================
  function valuations(v) {
    return (v.valuations || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
  }
  function addValuation(v, value, date) {
    v.valuations = v.valuations || [];
    v.valuations.push({ date: date || todayKey(), value: Number(value) || 0 });
  }
  function currentValue(v) {
    var list = valuations(v);
    return list.length ? list[list.length - 1].value : (Number(v.purchasePrice) || null);
  }
  /**
   * Cost per mile including depreciation — the number fuel-and-service apps
   * leave out, and most of the real answer on a car driven modestly.
   * Now also folds in every dollar actually logged (maintenance + parts +
   * fuel), not just service, which none of the researched competitors do.
   */
  function ownershipCost(v) {
    var purchasePrice = Number(v.purchasePrice);
    var startMiles = Number(v.purchaseMileage);
    if (!(purchasePrice > 0) || !(startMiles >= 0)) return null;
    var milesDriven = (Number(v.mileage) || 0) - startMiles;
    if (!(milesDriven > 0)) return null;
    var value = currentValue(v);
    var depreciation = value != null ? Math.max(0, purchasePrice - value) : 0;
    var maintCost = (v.maintenance || []).reduce(function (a, r) { return a + (Number(r.cost) || 0); }, 0);
    var partsCost = (v.parts || []).reduce(function (a, r) { return a + (Number(r.cost) || 0); }, 0);
    var fuelCost = (v.fuel || []).reduce(function (a, r) { return a + (Number(r.price) || 0); }, 0);
    var total = depreciation + maintCost + partsCost + fuelCost;
    return {
      milesDriven: milesDriven, depreciation: depreciation, maintCost: maintCost, partsCost: partsCost,
      fuelCost: fuelCost, total: total, perMile: total / milesDriven,
      depPerMile: depreciation / milesDriven, upkeepPerMile: (maintCost + partsCost) / milesDriven,
      fuelPerMile: fuelCost / milesDriven
    };
  }

  function fleetSummary() {
    var vehicles = state.vehicles || [];
    var totalSpend = 0, totalMiles = 0, dueCount = 0, overdueCount2 = 0;
    vehicles.forEach(function (v) {
      totalSpend += (v.maintenance || []).reduce(function (a, r) { return a + (Number(r.cost) || 0); }, 0);
      totalSpend += (v.fuel || []).reduce(function (a, r) { return a + (Number(r.price) || 0); }, 0);
      totalSpend += (v.parts || []).reduce(function (a, r) { return a + (Number(r.cost) || 0); }, 0);
      var oc = ownershipCost(v);
      if (oc) totalMiles += oc.milesDriven;
      vehicleDueList(v).forEach(function (d) {
        if (d.status === 'overdue') { dueCount++; overdueCount2++; }
        else if (d.status === 'soon') dueCount++;
      });
    });
    return { vehicles: vehicles.length, totalSpend: totalSpend, dueCount: dueCount, overdueCount: overdueCount2 };
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  /**
   * REPAIR AGE — a car's condition age versus its calendar age, built
   * entirely from data Dipstick already collects: service adherence, fault
   * codes, insurance claims, mileage pace, and fuel-efficiency trend. Each
   * dimension only counts once there's actually a signal to read (an empty
   * log says nothing, and a confident-looking number built on nothing is
   * worse than no number at all) — under 3 signals, this returns
   * unavailable rather than guess.
   */
  function repairAgeReport(v) {
    var year = Number(v.year);
    var currentYear = new Date().getFullYear();
    if (!(year > 1900) || year > currentYear + 1) {
      return { available: false, reason: 'no_year' };
    }
    var chronologicalAge = currentYear - year;
    var signals = [];

    var due = vehicleDueList(v);
    var tracked = due.filter(function (d) { return d.status !== 'none'; });
    if (tracked.length > 0) {
      var overdue = tracked.filter(function (d) { return d.status === 'overdue'; }).length;
      var soon = tracked.filter(function (d) { return d.status === 'soon'; }).length;
      var ok = tracked.filter(function (d) { return d.status === 'ok'; }).length;
      var scheduleDelta = Math.max(-1, Math.min(2.5, overdue * 0.4 + soon * 0.15 - ok * 0.05));
      signals.push({
        key: 'schedule', label: 'Service schedule adherence', delta: scheduleDelta,
        detail: overdue ? (overdue + ' service item' + (overdue === 1 ? '' : 's') + ' overdue')
          : (soon ? (soon + ' item' + (soon === 1 ? '' : 's') + ' due soon') : 'Caught up on everything tracked')
      });
    }

    var dtcEvents = v.dtcEvents || [];
    if (dtcEvents.length > 0) {
      var codeCount = 0;
      dtcEvents.forEach(function (e) { if (e.action === 'read') codeCount += (e.codes || []).length; });
      var faultDelta = Math.min(2.5, codeCount * 0.3);
      signals.push({
        key: 'faults', label: 'Fault code history', delta: faultDelta,
        detail: codeCount ? (codeCount + ' trouble code' + (codeCount === 1 ? '' : 's') + ' read over time') : 'No trouble codes logged'
      });
    }

    var claims = v.insuranceClaims || [];
    if (claims.length > 0) {
      var claimWeight = { accident: 0.8, theft: 0.3, glass: 0.1, weather: 0.2, liability: 0.4, other: 0.15 };
      var claimDelta = 0, accidents = 0;
      claims.forEach(function (c) { claimDelta += claimWeight[c.category] != null ? claimWeight[c.category] : 0.15; if (c.category === 'accident') accidents++; });
      claimDelta = Math.min(3, claimDelta);
      signals.push({
        key: 'claims', label: 'Insurance claim history', delta: claimDelta,
        detail: claims.length + ' claim' + (claims.length === 1 ? '' : 's') + (accidents ? ', ' + accidents + ' accident' + (accidents === 1 ? '' : 's') : '')
      });
    }

    var rate = mileageRate(v);
    if (rate.source === 'fitted') {
      var perYear = rate.perDay * 365;
      var ratio = perYear / DEFAULT_MILES_PER_YEAR;
      var mileageDelta = ratio > 1 ? Math.min(1.5, (ratio - 1) * 2.5) : Math.max(-1, (ratio - 1) * 1.8);
      signals.push({
        key: 'mileage', label: 'Mileage pace', delta: mileageDelta,
        detail: Math.round(perYear).toLocaleString() + ' mi/yr (typical is ' + DEFAULT_MILES_PER_YEAR.toLocaleString() + ')'
      });
    }

    var trend = fuelEfficiencyTrend(v);
    if (trend) {
      signals.push({ key: 'efficiency', label: 'Fuel efficiency trend', delta: trend.delta, detail: trend.detail });
    }

    var signalPoints = signals.length;
    var totalDelta = signals.reduce(function (a, s) { return a + s.delta; }, 0);
    if (signalPoints < 3) {
      return { available: false, reason: 'not_enough_data', signalPoints: signalPoints, chronologicalAge: chronologicalAge, signals: signals };
    }
    return {
      available: true, chronologicalAge: chronologicalAge, repairAge: round1(Math.max(0, chronologicalAge + totalDelta)),
      delta: round1(totalDelta), signalPoints: signalPoints, signals: signals
    };
  }

  function monthKey(ymd) { return String(ymd || '').slice(0, 7); }
  function fmtMonth(ym) {
    var p = String(ym).split('-');
    if (p.length < 2) return ym;
    var d = new Date(Number(p[0]), Number(p[1]) - 1, 1);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
  }
  /**
   * Fleet-wide spend trend — maintenance + fuel + parts across every
   * vehicle, bucketed by month. Complements the per-vehicle lifetime total
   * on the Cost tab with the "is this getting more expensive" view that
   * only shows up once you can see the whole garage over time.
   */
  function fleetMonthlySpend(monthsBack) {
    monthsBack = monthsBack || 12;
    var totals = {};
    function add(date, cost) {
      var c = Number(cost);
      if (!date || !(c > 0)) return;
      var key = monthKey(date);
      totals[key] = (totals[key] || 0) + c;
    }
    (state.vehicles || []).forEach(function (v) {
      (v.maintenance || []).forEach(function (r) { add(r.date, r.cost); });
      (v.fuel || []).forEach(function (r) { add(r.date, r.price); });
      (v.parts || []).forEach(function (r) { add(r.installedDate, r.cost); });
    });
    var out = [];
    var now = new Date();
    for (var i = monthsBack - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var key = d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
      out.push({ month: key, label: fmtMonth(key), total: totals[key] || 0 });
    }
    return out;
  }

  // =======================================================================
  // reminders — service due/soon, open recalls, warranties & documents
  // expiring, and now parts/tires wearing out. Same digest-into-Cache-API
  // design as the proven engine: the service worker cannot read
  // localStorage, so the page mirrors a small JSON blob it CAN read.
  // =======================================================================
  var REMINDER_CACHE = 'dipstick-reminders';
  var DIGEST_URL   = '__dipstick_reminders';
  var NOTIFIED_URL = '__dipstick_notified';
  var SYNC_TAG     = 'dipstick-due-check';
  var SYNC_MIN_MS  = 24 * 60 * 60 * 1000;

  function dueDetail(d) {
    var bits = [];
    if (d.remainingMiles != null) bits.push(d.remainingMiles <= 0 ? Math.abs(d.remainingMiles).toLocaleString() + ' mi over' : d.remainingMiles.toLocaleString() + ' mi to go');
    if (d.remainingDays != null) bits.push(d.remainingDays <= 0 ? Math.abs(d.remainingDays) + ' days over' : 'by ' + fmtDate(d.dueOn));
    return bits.join('  ·  ') || 'Due now.';
  }
  function reminderItems() {
    var out = [];
    (state.vehicles || []).forEach(function (v) {
      vehicleDueList(v).forEach(function (d) {
        if (d.status !== 'overdue' && d.status !== 'soon') return;
        out.push({ key: 'svc:' + v.id + ':' + d.type, kind: 'service', status: d.status,
          title: vehicleTitle(v) + ' — ' + d.type, detail: dueDetail(d) });
      });
      var mc = mileageCheckinStatus(v);
      if (mc.status === 'overdue' || mc.status === 'soon') {
        out.push({ key: 'mileage:' + v.id, kind: 'mileage', status: mc.status,
          title: vehicleTitle(v) + ' — Confirm your mileage',
          detail: mc.lastUpdated ? ('Last confirmed ' + mc.daysSince + ' days ago — every reminder above depends on this being current') : 'No odometer reading on file yet' });
      }
      var rc = recallStatus(v);
      if (rc.checked && rc.count > 0) {
        out.push({ key: 'recall:' + v.id + ':' + rc.count, kind: 'recall', status: rc.urgent ? 'overdue' : 'soon',
          title: vehicleTitle(v) + ' — ' + rc.count + ' open recall' + (rc.count === 1 ? '' : 's'),
          detail: rc.urgent ? 'A campaign says do not drive it until this is fixed.' : 'Free to have done at a franchised dealer.' });
      }
      (v.warranties || []).forEach(function (w) {
        var st = warrantyStatus(w, v);
        if (st.status === 'overdue' || st.status === 'soon') {
          out.push({ key: 'warr:' + v.id + ':' + w.id, kind: 'warranty', status: st.status,
            title: vehicleTitle(v) + ' — ' + w.name, detail: dueDetail(st) });
        }
      });
      (v.documents || []).forEach(function (d) {
        var st = documentStatus(d);
        if (st.status === 'overdue' || st.status === 'soon') {
          out.push({ key: 'doc:' + v.id + ':' + d.id, kind: 'document', status: st.status,
            title: vehicleTitle(v) + ' — ' + d.name, detail: dueDetail(st) });
        }
      });
      (v.parts || []).forEach(function (p) {
        var st = partStatus(p, v);
        if (st.status === 'overdue' || st.status === 'soon') {
          out.push({ key: 'part:' + v.id + ':' + p.id, kind: 'part', status: st.status,
            title: vehicleTitle(v) + ' — ' + p.name, detail: dueDetail(st) });
        }
      });
      (v.tires || []).forEach(function (t) {
        var st = tireWearStatus(t);
        if (st.status === 'overdue' || st.status === 'soon') {
          out.push({ key: 'tire:' + v.id + ':' + t.id, kind: 'tire', status: st.status,
            title: vehicleTitle(v) + ' — ' + t.position + ' tread', detail: (st.depth) + '/32" remaining' });
        }
      });
    });
    (state.inventory || []).forEach(function (item) {
      var st = inventoryStatus(item);
      if (st.status === 'overdue' || st.status === 'soon') {
        out.push({ key: 'inv:' + item.id, kind: 'inventory', status: st.status,
          title: item.name, detail: st.quantity <= 0 ? 'Out of stock' : st.quantity + ' left — reorder soon' });
      }
    });
    var rank = { overdue: 0, soon: 1 };
    return out.sort(function (a, b) { return rank[a.status] - rank[b.status]; });
  }
  function overdueCount() { return reminderItems().filter(function (i) { return i.status === 'overdue'; }).length; }
  function hasCacheStore() { return typeof caches !== 'undefined' && caches && typeof caches.open === 'function'; }
  function publishDigest() {
    if (!hasCacheStore()) return Promise.resolve(false);
    var body;
    try { body = JSON.stringify({ updated: todayKey(), items: reminderItems() }); } catch (e) { return Promise.resolve(false); }
    return caches.open(REMINDER_CACHE).then(function (c) {
      return c.put(DIGEST_URL, new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    }).then(function () { return true; }).catch(function () { return false; });
  }
  function refreshBadge() {
    if (!navigator.setAppBadge) return;
    var n = overdueCount();
    var p = n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge();
    if (p && p.catch) p.catch(function () {});
  }
  function reminderSupport() {
    var standalone = false;
    try { standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; } catch (e) {}
    return {
      notifications: typeof Notification !== 'undefined',
      permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
      periodicSync: 'serviceWorker' in navigator && typeof ServiceWorkerRegistration !== 'undefined' && 'periodicSync' in ServiceWorkerRegistration.prototype,
      badge: !!navigator.setAppBadge, installed: standalone
    };
  }
  function registerPeriodicSync() {
    var sup = reminderSupport();
    if (!sup.periodicSync) return Promise.resolve({ ok: false, reason: 'unsupported', message: 'This browser only checks while the app is open.' });
    return navigator.serviceWorker.ready.then(function (reg) {
      var q = (navigator.permissions && navigator.permissions.query)
        ? navigator.permissions.query({ name: 'periodic-background-sync' }).catch(function () { return { state: 'denied' }; })
        : Promise.resolve({ state: 'denied' });
      return q.then(function (st) {
        if (st.state !== 'granted') {
          return { ok: false, reason: 'permission', message: sup.installed
            ? 'The browser has not granted background checks yet — it grants them as you use the app.'
            : 'Install it to your home screen and background checks become available.' };
        }
        return reg.periodicSync.register(SYNC_TAG, { minInterval: SYNC_MIN_MS })
          .then(function () { return { ok: true, reason: 'registered', message: '' }; })
          .catch(function () { return { ok: false, reason: 'refused', message: 'The browser declined to schedule background checks.' }; });
      });
    }).catch(function () { return { ok: false, reason: 'error', message: 'Background checks are unavailable here.' }; });
  }
  function enableReminders() {
    var sup = reminderSupport();
    if (!sup.notifications) return Promise.resolve({ ok: false, reason: 'unsupported', message: 'This browser cannot show notifications.' });
    return Promise.resolve(Notification.requestPermission()).then(function (perm) {
      if (perm !== 'granted') {
        return { ok: false, reason: perm, message: perm === 'denied'
          ? 'Notifications are blocked for this site. Switch them back on in the browser’s own site settings.'
          : 'Nothing changed — the prompt was dismissed.' };
      }
      return publishDigest().then(registerPeriodicSync).then(function (sync) {
        refreshBadge();
        return { ok: true, background: sync.ok, reason: sync.reason,
          message: sync.ok ? 'Reminders on. Dipstick checks daily, even with the app closed.' : 'Reminders on. ' + sync.message };
      });
    }).catch(function () { return { ok: false, reason: 'error', message: 'The browser refused the request.' }; });
  }
  function disableReminders() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(true);
    return navigator.serviceWorker.ready.then(function (reg) {
      if (reg.periodicSync && reg.periodicSync.unregister) return reg.periodicSync.unregister(SYNC_TAG).catch(function () {});
    }).then(function () {
      if (navigator.clearAppBadge) { var p = navigator.clearAppBadge(); if (p && p.catch) p.catch(function () {}); }
      return true;
    }).catch(function () { return false; });
  }
  function testReminder() {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return Promise.resolve({ ok: false, message: 'Turn reminders on first.' });
    if (!('serviceWorker' in navigator)) return Promise.resolve({ ok: false, message: 'No service worker on this page.' });
    return publishDigest().then(function () { return navigator.serviceWorker.ready; }).then(function (reg) {
      var items = reminderItems();
      if (!items.length) {
        return reg.showNotification('Nothing is due', {
          body: 'Every tracked item on every vehicle is inside its window. This is what a reminder looks like when everything is fine.',
          tag: 'dipstick-due', icon: 'icon-512.png', badge: 'favicon.png', data: { url: 'index.html' }
        }).then(function () { return { ok: true, message: 'Sent — nothing is actually due.' }; });
      }
      if (reg.active) reg.active.postMessage({ type: 'dipstick-check', force: true });
      return { ok: true, message: 'Sent — check your notification shade.' };
    }).catch(function () { return { ok: false, message: 'The browser refused to show it.' }; });
  }

  // =======================================================================
  // export — backup JSON, per-log CSV, and an .ics calendar of what's due.
  // =======================================================================
  function triggerDownload(filename, mime, content) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function exportPayload() { return { app: 'DIPSTICK', format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), state: state }; }
  function exportBackup() {
    var payload = exportPayload();
    triggerDownload('dipstick-backup-' + todayKey() + '.json', 'application/json', JSON.stringify(payload, null, 2));
    state.lastExportAt = new Date().toISOString();
    scheduleSave();
  }
  function parseBackup(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('That file is not valid JSON.'); }
    if (!data || typeof data !== 'object') throw new Error('That file is empty.');
    if (data.app !== 'DIPSTICK') throw new Error('That is not a DIPSTICK backup.');
    if (!data.state || typeof data.state !== 'object') throw new Error('That backup has no data in it.');
    return data;
  }
  function importBackup(text) {
    var data = parseBackup(text);
    state = migrate(data.state);
    return saveState();
  }
  function toCSV(rows, columns) {
    var lines = [columns.map(function (c) { return c.label; }).join(',')];
    rows.forEach(function (r) {
      lines.push(columns.map(function (c) {
        var v = r[c.key];
        v = v == null ? '' : String(v);
        if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
        return v;
      }).join(','));
    });
    return lines.join('\r\n');
  }
  function exportMaintenanceCSV(v) {
    var csv = toCSV(v.maintenance || [], [
      { key: 'date', label: 'Date' }, { key: 'type', label: 'Service' }, { key: 'mileage', label: 'Odometer' },
      { key: 'cost', label: 'Cost' }, { key: 'notes', label: 'Notes' }, { key: 'diy', label: 'DIY' }
    ]);
    triggerDownload(vehicleTitle(v).replace(/\s+/g, '-') + '-maintenance.csv', 'text/csv', csv);
  }
  function exportFuelCSV(v) {
    var csv = toCSV(v.fuel || [], [
      { key: 'date', label: 'Date' }, { key: 'mileage', label: 'Odometer' }, { key: 'gallons', label: 'Gallons' },
      { key: 'kwh', label: 'kWh' }, { key: 'price', label: 'Cost' }, { key: 'full', label: 'Full tank' }, { key: 'notes', label: 'Notes' }
    ]);
    triggerDownload(vehicleTitle(v).replace(/\s+/g, '-') + '-fuel.csv', 'text/csv', csv);
  }
  function exportPartsCSV(v) {
    var csv = toCSV(v.parts || [], [
      { key: 'name', label: 'Part' }, { key: 'brand', label: 'Brand' }, { key: 'installedDate', label: 'Installed' },
      { key: 'installedMileage', label: 'Odometer' }, { key: 'cost', label: 'Cost' }, { key: 'notes', label: 'Notes' }
    ]);
    triggerDownload(vehicleTitle(v).replace(/\s+/g, '-') + '-parts.csv', 'text/csv', csv);
  }
  function exportInsuranceCSV(v) {
    var csv = toCSV(v.insuranceClaims || [], [
      { key: 'date', label: 'Date' }, { key: 'category', label: 'Category' }, { key: 'description', label: 'Description' },
      { key: 'insurer', label: 'Insurer' }, { key: 'claimedAmount', label: 'Claimed' }, { key: 'deductible', label: 'Deductible' },
      { key: 'paidAmount', label: 'Paid out' }, { key: 'status', label: 'Status' }, { key: 'notes', label: 'Notes' }
    ]);
    triggerDownload(vehicleTitle(v).replace(/\s+/g, '-') + '-insurance-claims.csv', 'text/csv', csv);
  }
  function icsEscape(s) { return String(s || '').replace(/[\\,;]/g, function (c) { return '\\' + c; }).replace(/\n/g, '\\n'); }
  function toICS(events) {
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DIPSTICK//EN'];
    events.forEach(function (e) {
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + e.uid + '@dipstick.local');
      lines.push('DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z');
      lines.push('DTSTART;VALUE=DATE:' + String(e.date).replace(/-/g, ''));
      lines.push('SUMMARY:' + icsEscape(e.title));
      if (e.detail) lines.push('DESCRIPTION:' + icsEscape(e.detail));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }
  function exportReminderICS() {
    var events = [];
    (state.vehicles || []).forEach(function (v) {
      vehicleDueList(v).forEach(function (d) {
        if (!d.dueOn && d.status === 'off') return;
        var date = d.dueOn || todayKey();
        events.push({ uid: 'svc-' + v.id + '-' + d.type.replace(/\s+/g, ''), date: date,
          title: vehicleTitle(v) + ' — ' + d.type + ' due', detail: dueDetail(d) });
      });
    });
    if (!events.length) return false;
    triggerDownload('dipstick-reminders.ics', 'text/calendar', toICS(events));
    return true;
  }

  // ---------------------------------------------------------------------
  // public API
  // ---------------------------------------------------------------------
  global.DIPSTICK = {
    // storage / state
    loadState: loadState, saveState: saveState, scheduleSave: scheduleSave, resetState: resetState,
    getState: getState, estimateBytes: estimateBytes, STORAGE_LIMIT_BYTES: STORAGE_LIMIT_BYTES,
    // theme
    getThemeChoice: getThemeChoice, resolvedTheme: resolvedTheme, setTheme: setTheme, initThemeToggle: initThemeToggle,
    // currency
    getCurrency: getCurrency, setCurrency: setCurrency, CURRENCIES: CURRENCIES,
    // helpers
    esc: escapeHtml, todayKey: todayKey, dayKey: dayKey, daysBetween: daysBetween, dateAddMonths: dateAddMonths,
    shiftDays: shiftDays, fmtMoney: fmtMoney, fmtMiles: fmtMiles, fmtDate: fmtDate, uid: uid,
    // vehicles
    getVehicle: getVehicle, addVehicle: addVehicle, removeVehicle: removeVehicle, vehicleTitle: vehicleTitle,
    recordMileage: recordMileage, mileageCheckinStatus: mileageCheckinStatus,
    MILEAGE_CHECKIN_SOON_DAYS: MILEAGE_CHECKIN_SOON_DAYS, MILEAGE_CHECKIN_OVERDUE_DAYS: MILEAGE_CHECKIN_OVERDUE_DAYS,
    // VIN + recalls
    normalizeVin: normalizeVin, isValidVin: isValidVin, decodeVin: decodeVin,
    fetchRecalls: fetchRecalls, refreshRecalls: refreshRecalls, recallStatus: recallStatus, RECALL_STALE_DAYS: RECALL_STALE_DAYS,
    // service schedule
    SERVICE_SCHEDULE: SERVICE_SCHEDULE, LOG_TYPE_SUGGESTIONS: LOG_TYPE_SUGGESTIONS, MAKE_INTERVALS: MAKE_INTERVALS, makeSchedule: makeSchedule, makeScheduleLabel: makeScheduleLabel,
    serviceInterval: serviceInterval, intervalSource: intervalSource, serviceTypesFor: serviceTypesFor,
    lastServiceOf: lastServiceOf, mileageRate: mileageRate, serviceDue: serviceDue, vehicleDueList: vehicleDueList,
    topDue: topDue, maintenanceCoverage: maintenanceCoverage, addMaintenance: addMaintenance, removeMaintenance: removeMaintenance,
    // fuel
    addFuelEntry: addFuelEntry, removeFuelEntry: removeFuelEntry, fuelEntries: fuelEntries, fuelStats: fuelStats,
    fuelEfficiencyTrend: fuelEfficiencyTrend,
    // documents / warranties / parts / tires
    addDocument: addDocument, removeDocument: removeDocument, documentStatus: documentStatus,
    addWarranty: addWarranty, removeWarranty: removeWarranty, warrantyStatus: warrantyStatus,
    addPart: addPart, removePart: removePart, partStatus: partStatus,
    addTire: addTire, removeTire: removeTire, addTreadReading: addTreadReading, tireWearStatus: tireWearStatus,
    expiryStatus: expiryStatus,
    // insurance claims
    addInsuranceClaim: addInsuranceClaim, removeInsuranceClaim: removeInsuranceClaim,
    updateInsuranceClaim: updateInsuranceClaim, CLAIM_CATEGORIES: CLAIM_CATEGORIES, CLAIM_STATUSES: CLAIM_STATUSES,
    // GPS trips
    gpsSupport: gpsSupport, startTrip: startTrip, stopTrip: stopTrip, discardActiveTrip: discardActiveTrip,
    isTripActive: isTripActive, activeTripSnapshot: activeTripSnapshot, removeTrip: removeTrip,
    tripStats: tripStats, tripRoutePoints: tripRoutePoints, haversineMiles: haversineMiles, suggestedMileage: suggestedMileage,
    // OBD2 diagnostics
    obdSupport: obdSupport, obdConnected: obdConnected, obdConnect: obdConnect, obdDisconnect: obdDisconnect,
    obdReadLive: obdReadLive, obdReadDTCs: obdReadDTCs, obdClearDTCs: obdClearDTCs,
    addObdReading: addObdReading, addDtcEvent: addDtcEvent, OBD_DTC_DICTIONARY: OBD_DTC_DICTIONARY,
    // providers
    addProvider: addProvider, updateProvider: updateProvider, getProvider: getProvider,
    removeProvider: removeProvider, providerUsage: providerUsage,
    // parts inventory
    addInventoryItem: addInventoryItem, getInventoryItem: getInventoryItem, removeInventoryItem: removeInventoryItem,
    adjustInventoryQty: adjustInventoryQty, inventoryStatus: inventoryStatus,
    // valuations / cost
    valuations: valuations, addValuation: addValuation, currentValue: currentValue,
    ownershipCost: ownershipCost, fleetSummary: fleetSummary, fleetMonthlySpend: fleetMonthlySpend,
    repairAgeReport: repairAgeReport,
    // reminders
    reminderItems: reminderItems, overdueCount: overdueCount, publishDigest: publishDigest, refreshBadge: refreshBadge,
    reminderSupport: reminderSupport, enableReminders: enableReminders, disableReminders: disableReminders, testReminder: testReminder,
    dueDetail: dueDetail,
    // export
    exportBackup: exportBackup, parseBackup: parseBackup, importBackup: importBackup,
    exportMaintenanceCSV: exportMaintenanceCSV, exportFuelCSV: exportFuelCSV, exportPartsCSV: exportPartsCSV,
    exportInsuranceCSV: exportInsuranceCSV,
    exportReminderICS: exportReminderICS
  };
})(window);
