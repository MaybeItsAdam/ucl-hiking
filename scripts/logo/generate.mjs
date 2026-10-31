#!/usr/bin/env node
/**
 * Procedural UCL Hiking Club app mark, in the club crest's own mountain style.
 *
 * Every mark is a pure function of (seed, fixed rules). Three straight-edged
 * triangular peaks step down in height from a dominant summit. Where two
 * overlap, a narrow wedge of sky cuts down between them along a steep back
 * edge, exactly as on the crest. Each peak carries an arrowhead snow cap inset
 * from the rock, with a notched base whose long-flank foot sits deeper.
 * Optional contour lines are offset beneath the ridge, and a slim lime dashed
 * trail climbs from a fixed trailhead to the foot of the summit snow by a
 * smoothed random walk. The seed varies only peak heights, positions and slopes,
 * how deep the overlaps cut, snow depth, the trail route and mirroring.
 *
 * Plain SVG strings, no dependencies. Rasterising (sheet/compare/export) shells
 * out to rsvg-convert and ImageMagick, the same tools
 * scripts/generate-app-icons.sh uses, and to headless Chrome for the sheets.
 *
 *   node scripts/logo/generate.mjs --seed 7                  # full icon SVG to stdout
 *   node scripts/logo/generate.mjs --seed 7 --contours       # ...with contour lines
 *   node scripts/logo/generate.mjs --seed 7 --layer foreground --out fg.svg
 *   node scripts/logo/generate.mjs --seed 7 --params         # the rolled parameters, as JSON
 *   node scripts/logo/generate.mjs --sheet --seeds 1-8 --out sheet.png
 *   node scripts/logo/generate.mjs --compare 3,5,8 --out vs.png
 *   node scripts/logo/generate.mjs --seed 7 --export [--contours]   # -> branding/logo/out/7/
 *
 * Geometry lives in a 1024 "design space" centred on (512, 512). Everything that
 * carries meaning (peaks, snow, trail ends) stays inside a circle of radius
 * SAFE_R there. The Android adaptive foreground draws the scene at ADAPTIVE_SCALE
 * into its 108dp layer, where the guaranteed-visible circle is 66dp (r = 313px at
 * 1024) and the Android 12+ splash and launcher show r = 341. The outer snow cap
 * reaches r ~362 unscaled, so 1:1 clipped its tip.
 * Full-bleed icons (iOS, web, legacy Android) scale the scene by FULL_SCALE so
 * the mark fills more of the tile while staying inside the iOS corner mask and
 * the 40% PWA maskable zone.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Brand colours. Fixed: the seed never touches colour. */
export const PALETTE = {
  // The brand teal (branding/brand.md), shared with the manifest theme_color and
  // Android's ic_launcher_background. globals.css's --forest #08a8ad is the UI
  // accent, a separate token.
  sky: "#01a2a6",
  rock: "#2d4153", //    --deep
  contour: "#4b6a84", // rock lifted toward --ink-fill: visible, still quieter than snow or trail
  snow: "#ffffff",
  lime: "#b9da3b", //    --lime
};

export const SAFE_R = 300; //     meaningful content radius in design space
export const FULL_SCALE = 1.3; // full-bleed icons: r 300 -> 390 (< 40% of 1024 = 409.6)
export const ADAPTIVE_SCALE = 0.85; // adaptive foreground: outer cap r ~362 -> ~307 (< 313)
const C = 512;

// ---------------------------------------------------------------- randomness

/** mulberry32: tiny, fast, good enough, and identical on every machine. */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    chance: (p) => next() < p,
    /** Roughly normal, mean 0, sd ~1. */
    gauss: () => next() + next() + next() + next() - 2,
  };
}

// ---------------------------------------------------------------- parameters

/**
 * Roll the parameters for a seed. Ranges are deliberately narrow: the seed
 * chooses *which* crest-style range, never whether it looks like the crest.
 * Slopes are dy/dx magnitudes of each flank (the crest sits around 1.1-1.3).
 */
export function params(seed) {
  const r = rng(seed * 2654435761);
  const peak = (x, y, kL, kR) => ({ x: r.range(...x), y: r.range(...y), kL: r.range(...kL), kR: r.range(...kR) });
  return {
    seed,
    peaks: [
      peak([352, 395], [262, 282], [1.0, 1.25], [1.5, 1.9]), // dominant, long gentle left flank
      peak([640, 690], [385, 432], [1.0, 1.3], [1.6, 2.0]),
      peak([790, 812], [482, 522], [1.0, 1.3], [0.85, 1.1]),
    ],
    // How far down each wedge of sky reaches (design y of its tip), and how
    // steep its back edge is. Cut shallower automatically if it would not fit.
    cleftTip: [r.range(640, 740), r.range(610, 690)],
    cleftSlope: [r.range(2.2, 3.4), r.range(2.2, 3.4)],
    snowDepth: r.range(0.3, 0.4), //    cap depth, as a share of the peak's visible height
    trailWander: r.range(35, 70),
    trailSwitchbacks: r.range(1.1, 2.0),
    mirror: r.chance(0.5),
    contourCount: 5,
    _r: r, // the stream continues into the procedural steps below
  };
}

// ---------------------------------------------------------------- geometry

/** Where flank lines y = a.y + k*|x - a.x| of two peaks cross (A's right, B's left). */
function flankMeet(A, B) {
  // A.y + A.kR (x - A.x) = B.y + B.kL (B.x - x)
  const x = (B.y - A.y + B.kL * B.x + A.kR * A.x) / (A.kR + B.kL);
  return { x, y: A.y + A.kR * (x - A.x) };
}

/** The crest's overlap: a slit of sky between peak A (in front) and B (behind). */
function cleft(A, B, depth, slope) {
  const meet = flankMeet(A, B);
  // Tip: further down A's right flank.
  const tip = { x: meet.x + depth / A.kR, y: meet.y + depth };
  // Back edge: from the tip, up-left at `slope`, until it meets B's left flank.
  // tip.y - slope*t = B.y + B.kL (B.x - (tip.x - t))
  const t = (tip.y - B.y - B.kL * (B.x - tip.x)) / (slope + B.kL);
  const shoulder = { x: tip.x - t, y: tip.y - slope * t };
  // The slit must stay a slit: shoulder between the meeting point and B's apex,
  // tip short of B's apex. Otherwise cut shallower.
  const ok = tip.x < B.x - 30 && shoulder.x > meet.x && shoulder.y > B.y + 60;
  if (!ok && depth > 10) return cleft(A, B, depth * 0.7, slope);
  return { tip, shoulder };
}

function ridgeline(p) {
  const [P1, P2, P3] = p.peaks;
  const depth = (A, B, tipY) => Math.max(10, tipY - flankMeet(A, B).y);
  const c1 = cleft(P1, P2, depth(P1, P2, p.cleftTip[0]), p.cleftSlope[0]);
  const c2 = cleft(P2, P3, depth(P2, P3, p.cleftTip[1]), p.cleftSlope[1]);
  const L = -420;
  const R = 1444;
  const pts = [
    { x: L, y: P1.y + P1.kL * (P1.x - L) },
    P1,
    c1.tip,
    c1.shoulder,
    P2,
    c2.tip,
    c2.shoulder,
    P3,
    { x: R, y: P3.y + P3.kR * (R - P3.x) },
  ];
  return { pts, clefts: [c1, c2] };
}

/** y of a polyline at x (linear). */
function yAt(pts, x) {
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i].x) {
      const a = pts[i - 1];
      const b = pts[i];
      return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1);
    }
  }
  return pts[pts.length - 1].y;
}

/**
 * Snow cap in the crest's shape: flanks parallel to the rock, inset by a thin
 * rim; base notched about a third of the way across, with the right-hand
 * (long-flank) foot dropping lower than the left.
 */
function snowCap(P, visible, p) {
  const rim = 16;
  const oL = rim * Math.hypot(1, P.kL);
  const oR = rim * Math.hypot(1, P.kR);
  const u = (oL - oR) / (P.kL + P.kR);
  const apex = { x: P.x + u, y: P.y + oR + P.kR * u };
  const d = Math.max(64, visible * p.snowDepth);
  const dL = d * 0.74;
  const left = { x: apex.x - dL / P.kL, y: apex.y + dL };
  const right = { x: apex.x + d / P.kR, y: apex.y + d };
  const notch = { x: left.x + (right.x - left.x) * 0.3, y: left.y - d * 0.12 };
  return { poly: [apex, right, notch, left], base: right.y };
}

/** Moving-average smoothing over evenly spaced samples. */
function smooth(ys, w) {
  if (w < 1) return ys.slice();
  return ys.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = -w; k <= w; k++) {
      const v = ys[i + k];
      if (v !== undefined) {
        s += v;
        n++;
      }
    }
    return s / n;
  });
}

function contours(pts, p) {
  const xs = [];
  for (let x = -420; x <= 1444; x += 8) xs.push(x);
  const base = xs.map((x) => yAt(pts, x));
  const lines = [];
  const gap = 62;
  for (let k = 1; k <= p.contourCount; k++) {
    const sm = smooth(base, 4 + k * 4);
    const mean = sm.reduce((a, b) => a + b, 0) / sm.length;
    const flat = 0.12 * k;
    lines.push(xs.map((x, i) => ({ x, y: sm[i] + (mean - sm[i]) * flat + k * gap })));
  }
  return lines;
}

/** Smoothed random walk from the fixed trailhead to the foot of the summit snow. */
function trail(pts, start, end, p, maxX) {
  const r = p._r;
  const N = 48;
  const walk = [0];
  for (let i = 1; i <= N; i++) walk.push(walk[i - 1] + r.gauss());
  // Brownian bridge: pin both ends to the straight line.
  const bridged = walk.map((w, i) => w - (walk[N] * i) / N);
  const sm = smooth(bridged, 4);
  const peakAbs = Math.max(...sm.map(Math.abs)) || 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const phase = r.range(0, Math.PI);
  const out = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const env = Math.sin(Math.PI * t); // fixed ends, free middle
    const lateral =
      env * ((sm[i] / peakAbs) * p.trailWander * 0.6 + Math.sin(phase + t * Math.PI * 2 * p.trailSwitchbacks) * p.trailWander * 0.6);
    let x = Math.min(maxX, start.x + dx * t + nx * lateral);
    let y = start.y + dy * t + ny * lateral;
    // Stay on the rock, inside the safe circle.
    if (i < N) y = Math.max(y, yAt(pts, x) + 50);
    const d = Math.hypot(x - C, y - C);
    if (d > SAFE_R - 12) {
      x = C + ((x - C) * (SAFE_R - 12)) / d;
      y = C + ((y - C) * (SAFE_R - 12)) / d;
    }
    out.push({ x, y });
  }
  return out;
}

/** Catmull-Rom through points -> cubic Bezier path data. */
function curve(points) {
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    d += `C${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)} ${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

// ---------------------------------------------------------------- scene

/** Build all geometry for a seed (design space, before mirroring). */
export function build(seed) {
  const p = params(seed);
  const { pts, clefts } = ridgeline(p);
  // A peak's visible height runs down to its higher neighbouring notch.
  const [P1, P2, P3] = p.peaks;
  const caps = [
    snowCap(P1, clefts[0].tip.y - P1.y, p),
    snowCap(P2, clefts[0].shoulder.y - P2.y, p),
    snowCap(P3, clefts[1].shoulder.y - P3.y, p),
  ];
  const start = { x: 500, y: 798 }; // fixed trailhead (inside the safe circle)
  const end = { x: P1.x + 6, y: caps[0].base + 40 }; // fixed rule: foot of the summit snow
  const path = trail(pts, start, end, p, clefts[0].tip.x - 60);
  const lines = contours(pts, p);
  return { p, pts, caps, path, lines };
}

const f = (n) => (Math.round(n * 10) / 10).toString();
const poly = (pts) => "M" + pts.map((q) => `${f(q.x)} ${f(q.y)}`).join("L") + "Z";

/** Foreground layer content in design space (no background). */
function foreground(g, { contours: withContours = false } = {}) {
  const { p, pts, caps, path, lines } = g;
  const body = [...pts, { x: 1444, y: 1700 }, { x: -420, y: 1700 }];
  const id = `b${p.seed}`;
  let s = "";
  s += `<path fill="${PALETTE.rock}" d="${poly(body)}"/>`;
  if (withContours) {
    s += `<clipPath id="${id}"><path d="${poly(body)}"/></clipPath>`;
    s += `<g clip-path="url(#${id})" fill="none" stroke="${PALETTE.contour}" stroke-width="10" stroke-linejoin="round">`;
    for (const l of lines) s += `<path d="M${l.map((q) => `${f(q.x)} ${f(q.y)}`).join("L")}"/>`;
    s += `</g>`;
  }
  for (const c of caps) s += `<path fill="${PALETTE.snow}" d="${poly(c.poly)}"/>`;
  // Slim, even dashes: a line at 29px, a route at 1024.
  s += `<path d="${curve(path)}" fill="none" stroke="${PALETTE.lime}" stroke-width="15" stroke-linecap="round" stroke-dasharray="16 26"/>`;
  return p.mirror ? `<g transform="matrix(-1 0 0 1 1024 0)">${s}</g>` : s;
}

const scaled = (inner, k) =>
  k === 1 ? inner : `<g transform="translate(512 512) scale(${k}) translate(-512 -512)">${inner}</g>`;
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${inner}</svg>`;

/**
 * layer: "full" (iOS/web/legacy Android tile), "foreground" (adaptive,
 * transparent) or "background". opts.contours draws the contour lines.
 */
export function render(seed, layer = "full", opts = {}) {
  if (layer === "background") return svg(`<rect width="1024" height="1024" fill="${PALETTE.sky}"/>`);
  const g = build(seed);
  if (layer === "foreground") return svg(scaled(foreground(g, opts), ADAPTIVE_SCALE));
  return svg(`<rect width="1024" height="1024" fill="${PALETTE.sky}"/>${scaled(foreground(g, opts), FULL_SCALE)}`);
}

// ---------------------------------------------------------------- raster helpers

function sh(cmd, args) {
  execFileSync(cmd, args, { stdio: ["ignore", "ignore", "inherit"] });
}
function need(cmd) {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
  } catch {
    throw new Error(`${cmd} not found on PATH (brew install librsvg imagemagick)`);
  }
}
function png(svgFile, size, out, { opaque = false } = {}) {
  sh("rsvg-convert", ["-w", String(size), "-h", String(size), svgFile, "-o", out]);
  if (opaque) sh("magick", [out, "-alpha", "off", "-type", "TrueColor", out]);
}

// ---------------------------------------------------------------- export

function exportSeed(seed, opts) {
  need("rsvg-convert");
  need("magick");
  const out = join(ROOT, "branding/logo/out", String(seed));
  rmSync(out, { recursive: true, force: true });
  const dir = (d) => (mkdirSync(join(out, d), { recursive: true }), join(out, d));

  const svgDir = dir("svg");
  const full = join(svgDir, "icon.svg");
  const fg = join(svgDir, "adaptive-foreground.svg");
  const bg = join(svgDir, "adaptive-background.svg");
  writeFileSync(full, render(seed, "full", opts));
  writeFileSync(fg, render(seed, "foreground", opts));
  writeFileSync(bg, render(seed, "background"));

  // Web: favicon, apple-touch, PWA manifest sizes. FULL_SCALE keeps the mark
  // inside the 40% maskable zone, so the "any" PNGs double as "maskable".
  const web = dir("web");
  writeFileSync(join(web, "icon.svg"), render(seed, "full", opts));
  for (const s of [16, 32, 48]) png(full, s, join(web, `favicon-${s}.png`));
  sh("magick", [join(web, "favicon-16.png"), join(web, "favicon-32.png"), join(web, "favicon-48.png"), join(web, "favicon.ico")]);
  png(full, 180, join(web, "apple-touch-icon.png"), { opaque: true });
  for (const s of [192, 512]) {
    png(full, s, join(web, `icon-${s}.png`));
    png(full, s, join(web, `icon-maskable-${s}.png`));
  }

  // iOS: single-size universal catalog, as in ios/App/App/Assets.xcassets.
  const ios = dir("ios/AppIcon.appiconset");
  png(full, 1024, join(ios, "AppIcon-512@2x.png"), { opaque: true });
  writeFileSync(
    join(ios, "Contents.json"),
    JSON.stringify(
      { images: [{ filename: "AppIcon-512@2x.png", idiom: "universal", platform: "ios", size: "1024x1024" }], info: { author: "xcode", version: 1 } },
      null,
      2,
    ) + "\n",
  );

  // Android: legacy square + round, adaptive foreground + background layers.
  const work = mkdtempSync(join(tmpdir(), "logo-"));
  for (const [density, legacy, adaptive] of [
    ["mdpi", 48, 108],
    ["hdpi", 72, 162],
    ["xhdpi", 96, 216],
    ["xxhdpi", 144, 324],
    ["xxxhdpi", 192, 432],
  ]) {
    const d = dir(`android/res/mipmap-${density}`);
    png(full, legacy, join(d, "ic_launcher.png"));
    png(full, legacy, join(work, "r.png"));
    const h = legacy / 2;
    sh("magick", [
      join(work, "r.png"), "-alpha", "on",
      "(", "-size", `${legacy}x${legacy}`, "xc:black", "-fill", "white", "-draw", `circle ${h},${h} ${h},0`, "-alpha", "off", ")",
      "-compose", "CopyOpacity", "-composite", join(d, "ic_launcher_round.png"),
    ]);
    png(fg, adaptive, join(d, "ic_launcher_foreground.png"));
    png(bg, adaptive, join(d, "ic_launcher_background.png"), { opaque: true });
  }
  const any = dir("android/res/mipmap-anydpi-v26");
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  writeFileSync(join(any, "ic_launcher.xml"), xml);
  writeFileSync(join(any, "ic_launcher_round.xml"), xml);
  writeFileSync(
    join(dir("android/res/values"), "ic_launcher_background.xml"),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${PALETTE.sky.toUpperCase()}</color>\n</resources>\n`,
  );
  png(full, 512, join(dir("android"), "playstore-icon.png"));
  rmSync(work, { recursive: true, force: true });

  writeFileSync(join(out, "params.json"), JSON.stringify({ ...publicParams(seed), contours: !!opts.contours }, null, 2) + "\n");
  return out;
}

function publicParams(seed) {
  const { _r, ...rest } = params(seed);
  return rest;
}

// ---------------------------------------------------------------- preview pages

const dataUri = (s) => `data:image/svg+xml;base64,${Buffer.from(s).toString("base64")}`;
const INK = PALETTE.rock;
const CSS = `
  body{margin:0;padding:24px;background:#fff;font:13px/1.3 -apple-system,"Helvetica Neue",Arial,sans-serif;color:${INK}}
  h1{font-size:18px;margin:0 0 16px}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
  .card{border:1px solid rgba(47,67,85,.18);border-radius:8px;padding:12px}
  .card header{margin-bottom:8px;font-size:15px}
  .row{display:flex;gap:12px}
  .col{display:flex;flex-direction:column;gap:8px;flex:1}
  .stack{position:relative;width:300px;height:300px}.stack img{position:absolute;inset:0}
  .sizes{display:flex;align-items:flex-end;gap:14px;padding:10px;border-radius:6px}
  figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:4px}
  figcaption{font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.75}
  img{display:block}`;
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><h1>${title}</h1>${body}</body></html>`;
const tile = (src, s) => `<img src="${src}" width="${s}" height="${s}" style="border-radius:${s * 0.2237}px">`;

function card(seed, opts) {
  const full = dataUri(render(seed, "full", opts));
  // Adaptive preview: background + foreground, cropped to the visible 72dp, then masked.
  const fgInner = scaled(foreground(build(seed), opts), ADAPTIVE_SCALE);
  const adaptive = (mask) =>
    dataUri(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="170.67 170.67 682.67 682.67"><defs><clipPath id="m">${mask}</clipPath></defs><g clip-path="url(#m)"><rect width="1024" height="1024" fill="${PALETTE.sky}"/>${fgInner}</g></svg>`,
    );
  const circle = adaptive(`<circle cx="512" cy="512" r="341.33"/>`);
  const squircle = adaptive(`<rect x="170.67" y="170.67" width="682.67" height="682.67" rx="205"/>`);
  const guide = dataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><circle cx="512" cy="512" r="${SAFE_R * FULL_SCALE}" fill="none" stroke="#ff2d55" stroke-width="3" stroke-dasharray="12 10"/></svg>`,
  );
  const sizes = (bgc, fgc) => `<div class="sizes" style="background:${bgc};color:${fgc}">
      <figure>${tile(full, 180)}<figcaption>180</figcaption></figure>
      <figure>${tile(full, 60)}<figcaption>60</figcaption></figure>
      <figure>${tile(full, 29)}<figcaption>29</figcaption></figure>
    </div>`;
  return `<section class="card">
    <header><b>seed ${seed}</b> · ${opts.contours ? "with contours" : "no contours"}</header>
    <div class="row">
      <figure class="big"><div class="stack"><img src="${full}" width="300" height="300"><img class="guide" src="${guide}" width="300" height="300"></div><figcaption>1024 (shown 300) · dashed = mark safe radius</figcaption></figure>
      <div class="col">
        ${sizes("#f7f7f3", INK)}
        ${sizes("#121a21", "#e3eaf0")}
        <div class="sizes" style="background:#e8edef;color:${INK}">
          <figure>${tile(full, 108)}<figcaption>iOS</figcaption></figure>
          <figure><img src="${circle}" width="108" height="108"><figcaption>Android circle</figcaption></figure>
          <figure><img src="${squircle}" width="108" height="108"><figcaption>Android squircle</figcaption></figure>
          <figure><img src="${circle}" width="48" height="48"><figcaption>48dp</figcaption></figure>
        </div>
      </div>
    </div>
  </section>`;
}

const sheetHtml = (seeds) =>
  page(
    "UCL Hiking Club · procedural mark candidates (each seed with and without contours)",
    `<div class="grid">${seeds.map((s) => card(s, { contours: true }) + card(s, { contours: false })).join("")}</div>`,
  );

function compareHtml(seeds, opts) {
  const current = dataUri(readFileSync(join(ROOT, "branding/app_icons/app-icon.svg"), "utf8"));
  const entries = [["current live icon", current], ...seeds.map((s) => [`seed ${s}`, dataUri(render(s, "full", opts))])];
  const row = (bgc, fgc) =>
    `<div class="sizes" style="background:${bgc};color:${fgc};gap:28px;padding:16px">${entries
      .map(([name, src]) => `<figure>${tile(src, 180)}<figcaption>${name} · 180</figcaption></figure><figure>${tile(src, 29)}<figcaption>29</figcaption></figure>`)
      .join("")}</div>`;
  return page(`Current icon vs shortlist${opts.contours ? " (with contours)" : ""}`, `<div class="col" style="gap:12px">${row("#f7f7f3", INK)}${row("#121a21", "#e3eaf0")}</div>`);
}

function chrome() {
  const candidates = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const hit = candidates.find((c) => existsSync(c));
  if (!hit) throw new Error("Chrome not found; set CHROME=/path/to/chrome");
  return hit;
}

function screenshot(html, outPng, width, height) {
  const htmlPath = outPng.replace(/\.png$/, ".html");
  writeFileSync(htmlPath, html);
  const profile = mkdtempSync(join(tmpdir(), "logo-chrome-"));
  sh(chrome(), [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    `--user-data-dir=${profile}`, `--window-size=${width},${height}`, `--screenshot=${outPng}`, `file://${htmlPath}`,
  ]);
  rmSync(profile, { recursive: true, force: true });
  return { html: htmlPath, png: outPng };
}

// ---------------------------------------------------------------- CLI

function parseSeeds(spec) {
  return spec.split(",").flatMap((part) => {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (!m) return [Number(part)];
    const out = [];
    for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i);
    return out;
  });
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const flag = (name) => argv.includes(`--${name}`);
  const opts = { contours: flag("contours") };
  const outPng = (fallback) => {
    const out = resolve(arg("out") ?? join(ROOT, "branding/logo/out", fallback));
    mkdirSync(dirname(out), { recursive: true });
    return out;
  };

  if (flag("sheet")) {
    const seeds = parseSeeds(arg("seeds") ?? "1-8");
    const r = screenshot(sheetHtml(seeds), outPng("candidates.png"), 1720, 24 + 40 + seeds.length * 636 + 24);
    return console.log(`sheet: ${r.png}\nhtml:  ${r.html}`);
  }
  if (arg("compare")) {
    const seeds = parseSeeds(arg("compare"));
    const r = screenshot(compareHtml(seeds, opts), outPng("compare.png"), 120 + (seeds.length + 1) * 290, 600);
    return console.log(`compare: ${r.png}`);
  }

  const seedArg = arg("seed");
  if (seedArg === undefined || !/^\d+$/.test(seedArg)) {
    console.error(
      "usage: generate.mjs --seed N [--contours] [--layer full|foreground|background] [--out file.svg] [--params] [--export]\n" +
        "       generate.mjs --sheet [--seeds 1-8] [--out sheet.png]\n" +
        "       generate.mjs --compare 3,5,8 [--contours] [--out vs.png]",
    );
    process.exit(1);
  }
  const seed = Number(seedArg);
  if (flag("params")) return console.log(JSON.stringify(publicParams(seed), null, 2));
  if (flag("export")) return console.log(`exported: ${exportSeed(seed, opts)}`);
  const s = render(seed, arg("layer") ?? "full", opts);
  const out = arg("out");
  if (out) writeFileSync(out, s + "\n");
  else process.stdout.write(s + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
