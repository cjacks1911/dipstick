/**
 * DIPSTICK service worker.
 *
 * Same design as the proven engine it was ported from: HTML is network-first
 * so a deploy always reaches you on the next load; CSS/JS/icons are
 * cache-first with a background refresh; nothing else is cached, because the
 * only cross-origin calls this app makes are NHTSA VIN/recall lookups, and a
 * stale recall answer served silently would be worse than no answer at all.
 */
var CACHE_VERSION  = 'dipstick-v1';
var REMINDER_CACHE = 'dipstick-reminders';

var SHELL = [
  'index.html', 'vehicle.html', 'providers.html', 'privacy.html',
  'app.css', 'app.js', 'manifest.json',
  'favicon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k === CACHE_VERSION || k === REMINDER_CACHE) return null;
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* ---------------------------------------------------------------------
 * Reminders — same digest-in-Cache-API design as the engine this is
 * ported from. The worker cannot read localStorage, so the page mirrors a
 * small JSON blob into the Cache API on every save, and this file only
 * ever does date arithmetic on that blob — no scoring logic lives here.
 * ------------------------------------------------------------------- */
var DIGEST_URL   = '__dipstick_reminders';
var NOTIFIED_URL = '__dipstick_notified';
var SYNC_TAG     = 'dipstick-due-check';
var RENOTIFY_DAYS = { overdue: 7, soon: 14 };

function readJson(url, fallback) {
  return caches.open(REMINDER_CACHE).then(function (c) { return c.match(url); })
    .then(function (r) { return r ? r.json() : fallback; }).catch(function () { return fallback; });
}
function writeJson(url, obj) {
  return caches.open(REMINDER_CACHE).then(function (c) {
    return c.put(url, new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } }));
  }).catch(function () {});
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function todayKey() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function daysSince(ymd) {
  if (!ymd) return Infinity;
  var p = String(ymd).split('-');
  var then = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  var ms = Date.now() - then.getTime();
  return isNaN(ms) ? Infinity : Math.floor(ms / 86400000);
}
function setBadge(n) {
  try {
    if (n > 0 && self.navigator && self.navigator.setAppBadge) { var p = self.navigator.setAppBadge(n); if (p && p.catch) p.catch(function () {}); }
    else if (self.navigator && self.navigator.clearAppBadge) { var q = self.navigator.clearAppBadge(); if (q && q.catch) q.catch(function () {}); }
  } catch (e) {}
}
function showDigest(items) {
  var title, body;
  if (items.length === 1) {
    title = items[0].status === 'overdue' ? 'Overdue' : 'Coming up soon';
    body = items[0].title + '\n' + items[0].detail;
  } else {
    var over = items.filter(function (i) { return i.status === 'overdue'; }).length;
    title = over ? over + ' overdue in your garage' : items.length + ' coming up soon';
    body = items.slice(0, 3).map(function (i) { return '• ' + i.title; }).join('\n');
    if (items.length > 3) body += '\n…and ' + (items.length - 3) + ' more';
  }
  return self.registration.showNotification(title, {
    body: body, tag: 'dipstick-due', renotify: true,
    icon: 'icon-512.png', badge: 'favicon.png', data: { url: 'index.html' }
  });
}
function runDueCheck(force) {
  return Promise.all([readJson(DIGEST_URL, null), readJson(NOTIFIED_URL, {})]).then(function (r) {
    var digest = r[0], notified = r[1] || {};
    var items = (digest && digest.items) || [];
    setBadge(items.filter(function (i) { return i.status === 'overdue'; }).length);
    if (!items.length) return;
    var speak = force ? items : items.filter(function (i) { return daysSince(notified[i.key]) >= (RENOTIFY_DAYS[i.status] || 14); });
    if (!speak.length) return;
    var today = todayKey();
    speak.forEach(function (i) { notified[i.key] = today; });
    return writeJson(NOTIFIED_URL, notified).then(function () { return showDigest(speak); });
  }).catch(function () {});
}

self.addEventListener('periodicsync', function (e) { if (e.tag === SYNC_TAG) e.waitUntil(runDueCheck(false)); });
self.addEventListener('message', function (e) { var d = e.data || {}; if (d.type === 'dipstick-check') e.waitUntil(runDueCheck(!!d.force)); });
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || 'index.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(self.location.origin) === 0 && 'focus' in list[i]) {
          if ('navigate' in list[i]) list[i].navigate(target).catch(function () {});
          return list[i].focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (req.url.indexOf('__dipstick_') > -1) return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return; // NHTSA calls: never cached

  var isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') > -1;
  if (isHTML) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () { return caches.match(req).then(function (hit) { return hit || caches.match('index.html'); }); })
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(function (hit) {
      var live = fetch(req).then(function (res) {
        if (res && res.ok) { var copy = res.clone(); caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); }); }
        return res;
      }).catch(function () { return hit; });
      return hit || live;
    })
  );
});
