/*
 * UCL Hiking Club service worker: keeps the pages used where there's no signal
 * openable offline: a walk's "On the day" register (on the hill) and the kit
 * lender's Equipment page (scanning kit in the kit room or the car park).
 * Their data already lives in localStorage (src/lib/dayOffline.ts,
 * src/components/kit/KitLender.tsx); this worker keeps the pages themselves,
 * which need their HTML and scripts.
 *
 * - When one of those pages loads with signal, it asks this worker (a
 *   "keep-page" message) to save its HTML and every /_next/static file it
 *   uses. No other page is saved.
 * - Opening a saved page goes to the network first; with no signal, or no
 *   answer within a few seconds, the saved copy opens instead.
 * - Any other page that can't load offline gets a small page listing the
 *   saved ones, rather than the browser's ERR_INTERNET_DISCONNECTED.
 * - Each saved page goes when the page says (a walk: a day after it ends;
 *   kit: two weeks after it was last opened), and all of them on sign-out.
 *
 * Registered in production only (ServiceWorker.tsx). Phone browsers, the
 * Android app and the iOS app (through app-bound domains) run it.
 */

const STATIC = "hiking-static-v1";
const PAGES = "hiking-walk-days-v1";
const INDEX = "/__walk-days.json"; // kept in PAGES: [{ path, name, when, expires, assets }]
/** The only pages this worker will save. */
const KEEPABLE = [/^\/portal\/events\/[^/]+\/day\/?$/, /^\/portal\/equipment\/?$/];
const keepable = (path) => KEEPABLE.some((re) => re.test(path));
const NETWORK_WAIT_MS = 4000;

const QUIPS = [
  "Classic hill.",
  "Zero bars. You must be somewhere lovely.",
  "The internet stayed in London.",
  "Out of signal, hopefully not out of snacks.",
];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("hiking-") && key !== STATIC && key !== PAGES) await caches.delete(key);
      }
      await prune();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  // "keep-walk-day" is the older name, still sent by pages saved before the rename.
  if (data && (data.type === "keep-page" || data.type === "keep-walk-day")) event.waitUntil(keep(data));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Signing out forgets every saved walk: the pages carry the member's name.
  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    event.waitUntil(forgetAll());
    return;
  }
  if (request.method !== "GET") return;

  // Build files are named by their content, so a saved one never goes stale.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches
        .open(STATIC)
        .then((cache) => cache.match(request))
        .then((hit) => hit || fetch(request)),
    );
    return;
  }

  if (request.mode === "navigate") event.respondWith(navigate(request, url));
});

async function navigate(request, url) {
  const saved = keepable(url.pathname) ? await (await caches.open(PAGES)).match(url.pathname) : undefined;
  const network = fetch(request);
  try {
    if (!saved) return await network;
    // A slow hillside connection shouldn't keep the register from opening.
    network.catch(() => {});
    return await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), NETWORK_WAIT_MS)),
    ]);
  } catch {
    if (saved) return saved;
    return offlinePage();
  }
}

/** Save a page and its build files, as asked by the page itself. */
async function keep({ path, name, when, expires, assets }) {
  if (typeof path !== "string" || !keepable(path) || !(expires > Date.now())) return;
  let res;
  try {
    res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  } catch {
    return;
  }
  if (!res.ok || res.redirected) return;

  // The files the HTML names, plus any the page loaded later (the register itself).
  const html = await res.clone().text();
  const named = html.match(/\/_next\/static\/[^"'\s\\)]+/g) || [];
  const files = new Set();
  for (const raw of [...named, ...(Array.isArray(assets) ? assets : [])]) {
    try {
      const u = new URL(raw, self.location.origin);
      if (u.origin === self.location.origin && u.pathname.startsWith("/_next/static/")) files.add(u.href);
    } catch {
      // Not a URL; skip it.
    }
  }

  const statics = await caches.open(STATIC);
  await Promise.all(
    [...files].map(async (href) => {
      if (await statics.match(href)) return;
      try {
        const r = await fetch(href);
        if (r.ok) await statics.put(href, r);
      } catch {
        // Missing one file only matters if that file is needed offline.
      }
    }),
  );

  await (await caches.open(PAGES)).put(path, res);
  const list = (await readIndex()).filter((e) => e.path !== path);
  list.push({ path, name: String(name || "Saved page"), when: String(when || ""), expires, assets: [...files] });
  await writeIndex(list);
  await prune();
}

async function readIndex() {
  const hit = await (await caches.open(PAGES)).match(INDEX);
  try {
    return hit ? await hit.json() : [];
  } catch {
    return [];
  }
}

async function writeIndex(list) {
  await (await caches.open(PAGES)).put(
    INDEX,
    new Response(JSON.stringify(list), { headers: { "content-type": "application/json" } }),
  );
}

/** Drop walks past their expiry, and any build file no saved walk still needs. */
async function prune() {
  const now = Date.now();
  const list = await readIndex();
  const live = list.filter((e) => e.expires > now);
  const pages = await caches.open(PAGES);
  for (const e of list) if (!live.includes(e)) await pages.delete(e.path);
  await writeIndex(live);

  const needed = new Set(live.flatMap((e) => e.assets || []));
  const statics = await caches.open(STATIC);
  for (const request of await statics.keys()) if (!needed.has(request.url)) await statics.delete(request);
}

async function forgetAll() {
  await caches.delete(PAGES);
  await caches.delete(STATIC);
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Shown for any page that can't load offline: the saved walks, and a way back. */
async function offlinePage() {
  const now = Date.now();
  const walks = (await readIndex()).filter((e) => e.expires > now);
  const quip = QUIPS[Math.floor(Math.random() * QUIPS.length)];
  const list = walks.length
    ? `<p class="label">Saved on this phone</p><ul>${walks
        .map((w) => `<li><a href="${esc(w.path)}"><strong>${esc(w.name)}</strong><span>${esc(w.when)}</span></a></li>`)
        .join("")}</ul>`
    : "";
  const html = `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Offline | UCL Hiking Club</title>
<style>
:root{--paper:#f7f7f3;--surface:#fff;--ink:#2f4355;--muted:#64748b;--line:rgba(47,67,85,.15);--forest:#08a8ad}
@media (prefers-color-scheme:dark){:root{--paper:#121a21;--surface:#1c2630;--ink:#e3eaf0;--muted:#94a3b8;--line:rgba(227,234,240,.14)}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;background:var(--paper);color:var(--ink);
font:400 16px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
padding:calc(24px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left))}
main{width:100%;max-width:26rem;text-align:center}
.eyebrow{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#f26640;margin:0 0 8px}
h1{font:800 28px/1.2 "Avenir Next",Avenir,"Segoe UI",sans-serif;margin:0 0 8px}
p{margin:0 0 20px;color:var(--muted)}
.label{font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;margin:24px 0 8px;text-align:left}
ul{list-style:none;margin:0 0 20px;padding:0;border:1px solid var(--line);border-radius:8px;background:var(--surface);text-align:left}
li+li{border-top:1px solid var(--line)}
a{display:flex;flex-direction:column;gap:2px;padding:12px 14px;min-height:44px;color:inherit;text-decoration:none}
a span{font-size:13px;color:var(--muted)}
button{font:inherit;font-weight:700;color:#2f4355;background:var(--forest);border:0;border-radius:6px;min-height:44px;padding:10px 22px}
</style></head>
<body><main>
<p class="eyebrow">No signal</p>
<h1>You’re offline</h1>
<p>${esc(quip)} ${walks.length ? "Saved pages still open below." : "This page needs a connection."}</p>
${list}
<button type="button" onclick="location.reload()">Try again</button>
</main>
<script>addEventListener("online",function(){setTimeout(function(){location.reload()},600)})</script>
</body></html>`;
  // 200, not 503: the Android app swaps any failed page for its own error page.
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
