const CACHE = "dissonance-lock-v1.19";
const ASSETS = [
  "./",
  "./icon-192.png",
  "./icon-512.png",
  "./index.html",
  "./js/core/laws/audit.js",
  "./js/core/laws/fit.js",
  "./js/core/laws/index.js",
  "./js/core/laws/laws.js",
  "./js/core/strata/clock.js",
  "./js/core/strata/dissonance.js",
  "./js/core/strata/feedback.js",
  "./js/core/strata/fermat.js",
  "./js/core/strata/index.js",
  "./js/core/strata/ledger.js",
  "./js/core/strata/locate.js",
  "./js/core/strata/propagate.js",
  "./js/core/strata/tree.js",
  "./js/core/strata/vec.js",
  "./js/core/strata/zeta.js",
  "./js/game/gen.js",
  "./js/game/levels.js",
  "./js/game/lore.js",
  "./js/game/main.js",
  "./js/game/pad.js",
  "./js/game/render.js",
  "./js/game/rng.js",
  "./js/game/save.js",
  "./js/game/sfx.js",
  "./js/game/state.js",
  "./js/game/tutorial.js",
  "./js/lab/bulk.js",
  "./js/lab/forge.js",
  "./js/lab/lab.js",
  "./js/lab/observatory.js",
  "./js/lab/spacetime.js",
  "./js/lab/trials.js",
  "./js/lab/world.js",
  "./manifest.webmanifest"
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return;
  e.respondWith(
    fetch(r)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); }
        return res;
      })
      .catch(() => caches.match(r).then((m) => m || caches.match("./index.html"))),
  );
});
