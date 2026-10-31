#!/usr/bin/env node
/**
 * Procedural UCL Hiking Club app mark.
 *
 * Every mark is a pure function of (seed, fixed rules): a three-peak ridgeline
 * built by seeded midpoint displacement, snow caps cut by a snowline rule,
 * contour lines offset beneath the ridge, a dashed lime trail that climbs from a
 * fixed trailhead to the foot of the summit snow by a smoothed random walk, and
 * an optional compass disc dropped into whichever patch of sky is clearest.
 * Plain SVG strings, no dependencies. Rasterising (sheet/export) shells out to
 * rsvg-convert and ImageMagick, the same tools scripts/generate-app-icons.sh
 * uses, and to headless Chrome for the candidate sheet.
 *
 *   node scripts/logo/generate.mjs --seed 7                 # full icon SVG to stdout
 *   node scripts/logo/generate.mjs --seed 7 --layer foreground --out fg.svg
 *   node scripts/logo/generate.mjs --seed 7 --params        # the rolled parameters, as JSON
 *   node scripts/logo/generate.mjs --sheet --seeds 1-12 --out sheet.png
 *   node scripts/logo/generate.mjs --seed 7 --export        # every size -> branding/logo/out/7/
 *
 * Geometry lives in a 1024 "design space" centred on (512, 512). Everything that
 * carries meaning (peaks, snow, trail ends, compass) stays inside a circle of
 * radius SAFE_R there. The Android adaptive foreground draws design space 1:1
 * into its 108dp layer, where the guaranteed-visible circle is 66dp (r = 313px
 * at 1024). Full-bleed icons (iOS, web, legacy Android) scale the scene by
 * FULL_SCALE so the mark fills more of the tile while staying inside the iOS
 * corner mask and the 40% PWA maskable zone.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Brand tokens, from src/app/globals.css. Fixed: the seed never touches colour. */
export const PALETTE = {
  sky: "#08a8ad", //   --forest / --green
  rock: "#2d4153", //  --deep
  contour: "#3a5570", // --ink-fill (dark-mode raised slate): one step off the rock
  snow: "#ffffff",
  lime: "#b9da3b", //  --lime
};

export const SAFE_R = 300; //       meaningful content radius in design space
export const FULL_SCALE = 1.3; //   full-bleed icons: r 300 -> 390 (< 40% of 1024 = 409.6)
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
    int: (lo, hi) => lo + Math.floor((hi - lo + 1) * next()),
    chance: (p) => next() < p,
    /** Roughly normal, mean 0, sd ~1. */
    gauss: () => next() + next() + next() + next() - 2,
  };
}

// ---------------------------------------------------------------- parameters

/**
 * Roll the parameters for a seed. Ranges are deliberately narrow: the seed
 * chooses *which* balanced mountain, never whether it is balanced.
 */
export function params(seed) {
  const r = rng(seed * 2654435761);
  const summit = { x: r.range(470, 545), y: r.range(248, 282) };
  const left = { x: r.range(262, 330), y: r.range(405, 470) };
  const right = { x: r.range(690, 765), y: r.range(352, 425) };
  return {
    seed,
    peaks: 3, //                                fixed
    mirror: r.chance(0.5), //                   dominant flank faces left or right
    summit,
    left,
    right,
    saddleL: r.range(55, 105), //               valley depth below the lower neighbour
    saddleR: r.range(60, 115),
    roughness: r.range(0.32, 0.55), //          midpoint-displacement amplitude
    snowDepth: r.range(0.4, 0.5), //            snowline, as a share of prominence
    snowTeeth: r.int(2, 3),
    trailWander: r.range(55, 100), //           random-walk amplitude
    trailSwitchbacks: r.range(1.2, 2.2), //     zig-zags on the climb
    compass: r.chance(0.8),
    compassBearing: r.range(-35, 35),
    contours: r.int(4, 6),
    _r: r, // the stream continues into the procedural steps below
  };
}

// ---------------------------------------------------------------- geometry

/** Seeded midpoint displacement between two ridge anchors, clamped so no
 *  intermediate point can rise above the higher anchor (peaks stay peaks). */
function displace(a, b, depth, amp, r, out) {
  if (depth === 0) return;
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + r.gauss() * amp };
  const top = Math.min(a.y, b.y) + 14;
  const floor = Math.max(a.y, b.y) + 30;
  m.y = Math.max(top, Math.min(floor, m.y));
  displace(a, m, depth - 1, amp * 0.55, r, out);
  out.push(m);
  displace(m, b, depth - 1, amp * 0.55, r, out);
}

function ridgeline(p) {
  const r = p._r;
  const { summit: S, left: L, right: R } = p;
  const anchors = [
    { x: -420, y: 700 },
    { x: 115, y: r.range(545, 590) },
    { ...L, peak: true },
    { x: (L.x + S.x) / 2 + r.range(-20, 20), y: L.y + p.saddleL },
    { ...S, peak: true, summit: true },
    { x: (S.x + R.x) / 2 + r.range(-20, 20), y: R.y + p.saddleR },
    { ...R, peak: true },
    { x: 910, y: R.y + r.range(150, 200) },
    { x: 1444, y: 720 },
  ];
  const pts = [anchors[0]];
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1];
    const b = anchors[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const span = []; // displaced interior points
    // Only the visible stretch gets detail; the far wings stay quiet.
    const depth = a.x < 0 || b.x > 1024 ? 2 : 3;
    displace(a, b, depth, p.roughness * len * 0.16, r, span);
    pts.push(...span, b);
  }
  return { pts, anchors };
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

/** Snow cap: ridge above the snowline, closed by a toothed lower edge. */
function snowCap(pts, peak, valleyY, p) {
  const r = p._r;
  const i0 = pts.findIndex((q) => q.x === peak.x && q.y === peak.y);
  const prominence = valleyY - peak.y;
  // Big enough to survive 29px: the summit always gets a deep cap.
  // Never below the higher saddle, or the cap would spill onto a neighbour.
  const line = Math.min(valleyY - 22, peak.y + Math.max(peak.summit ? 92 : 56, prominence * p.snowDepth));
  const cross = (i, step) => {
    let j = i;
    while (pts[j + step] && pts[j + step].y < line) j += step;
    const a = pts[j];
    const b = pts[j + step];
    const t = (line - a.y) / (b.y - a.y);
    return { j, at: { x: a.x + (b.x - a.x) * t, y: line } };
  };
  const L = cross(i0, -1);
  const R = cross(i0, +1);
  const poly = [L.at, ...pts.slice(L.j, R.j + 1), R.at];
  const n = p.snowTeeth;
  const width = R.at.x - L.at.x;
  const tooth = Math.min(54, Math.max(20, width * 0.22));
  for (let k = 1; k < 2 * n; k++) {
    const x = R.at.x - (width * k) / (2 * n) + r.range(-6, 6);
    const y = k % 2 ? line + tooth * r.range(0.6, 1) : line + r.range(0, 8);
    poly.push({ x, y: Math.max(y, yAt(pts, x) + 6) });
  }
  return { poly, line, toothMax: tooth };
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
  const gap = 56;
  for (let k = 1; k <= p.contours; k++) {
    const sm = smooth(base, 2 + k * 3);
    const mean = sm.reduce((a, b) => a + b, 0) / sm.length;
    const flat = 0.1 * k;
    lines.push(xs.map((x, i) => ({ x, y: sm[i] + (mean - sm[i]) * flat + k * gap })));
  }
  return lines;
}

/** Smoothed random walk from the fixed trailhead to the foot of the summit snow. */
function trail(pts, start, end, p) {
  const r = p._r;
  const N = 40;
  const walk = [0];
  for (let i = 1; i <= N; i++) walk.push(walk[i - 1] + r.gauss());
  // Brownian bridge: pin both ends to the straight line.
  const bridged = walk.map((w, i) => w - (walk[N] * i) / N);
  const sm = smooth(bridged, 3);
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
      env * ((sm[i] / peakAbs) * p.trailWander * 0.6 + Math.sin(phase + t * Math.PI * 2 * p.trailSwitchbacks) * p.trailWander * 0.55);
    let x = start.x + dx * t + nx * lateral;
    let y = start.y + dy * t + ny * lateral;
    // Stay on the mountain, inside the safe circle.
    if (i < N) y = Math.max(y, yAt(pts, x) + 46);
    const d = Math.hypot(x - C, y - C);
    if (d > SAFE_R - 14) {
      x = C + ((x - C) * (SAFE_R - 14)) / d;
      y = C + ((y - C) * (SAFE_R - 14)) / d;
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

/** Distance from a point to a polyline. */
function distToPolyline(pt, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * vx + (pt.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
    best = Math.min(best, Math.hypot(pt.x - a.x - vx * t, pt.y - a.y - vy * t));
  }
  return best;
}

/** Clearest patch of sky that keeps the whole disc in the safe circle. */
function compassSpot(pts, p) {
  const R = 58;
  let best = null;
  for (let y = 250; y <= 520; y += 6) {
    for (let x = 220; x <= 804; x += 6) {
      if (Math.hypot(x - C, y - C) + R + 8 > SAFE_R) continue;
      if (y + R > yAt(pts, x) - 10) continue; // must be sky, not rock
      const clear = distToPolyline({ x, y }, pts);
      if (clear < R + 26) continue;
      // Prefer high, and away from the summit so the two don't crowd.
      const score = -y * 0.6 + Math.abs(x - p.summit.x) * 0.5 + Math.min(clear, 140) * 0.4;
      if (!best || score > best.score) best = { x, y, r: R, score };
    }
  }
  return best;
}

// ---------------------------------------------------------------- scene

/** Build all geometry for a seed (design space, before mirroring). */
export function build(seed) {
  const p = params(seed);
  const { pts, anchors } = ridgeline(p);
  const valley = (i) => Math.min(anchors[i - 1].y, anchors[i + 1].y);
  const caps = anchors
    .map((a, i) => (a.peak ? snowCap(pts, a, valley(i), p) : null))
    .filter(Boolean);
  const summitCap = caps[1];
  const start = { x: 382, y: 772 }; // fixed trailhead (inside the safe circle)
  const end = { x: p.summit.x + 4, y: summitCap.line + summitCap.toothMax + 22 }; // fixed rule
  const path = trail(pts, start, end, p);
  const lines = contours(pts, p);
  const compass = p.compass ? compassSpot(pts, p) : null;
  return { p, pts, caps, path, lines, compass };
}

const f = (n) => (Math.round(n * 10) / 10).toString();
const poly = (pts) => "M" + pts.map((q) => `${f(q.x)} ${f(q.y)}`).join("L") + "Z";

/** Foreground layer content in design space (no background). */
function foreground(g) {
  const { p, pts, caps, path, lines, compass } = g;
  const body = [...pts, { x: 1444, y: 1700 }, { x: -420, y: 1700 }];
  const id = `b${p.seed}`;
  let s = "";
  s += `<clipPath id="${id}"><path d="${poly(body)}"/></clipPath>`;
  s += `<path fill="${PALETTE.rock}" d="${poly(body)}"/>`;
  s += `<g clip-path="url(#${id})" fill="none" stroke="${PALETTE.contour}" stroke-width="7" stroke-linejoin="round">`;
  for (const l of lines) s += `<path d="M${l.map((q) => `${f(q.x)} ${f(q.y)}`).join("L")}"/>`;
  s += `</g>`;
  for (const c of caps) s += `<path fill="${PALETTE.snow}" d="${poly(c.poly)}"/>`;
  s += `<path d="${curve(path)}" fill="none" stroke="${PALETTE.lime}" stroke-width="22" stroke-linecap="round" stroke-dasharray="24 32"/>`;
  // Trailhead and summit waypoint: solid dots so the route has ends at any size.
  s += `<circle cx="${f(path[0].x)}" cy="${f(path[0].y)}" r="20" fill="${PALETTE.lime}"/>`;
  if (compass) {
    const { x, y, r } = compass;
    s += `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(p.compassBearing)})">`;
    s += `<circle r="${r}" fill="${PALETTE.rock}"/><circle r="${r - 12}" fill="${PALETTE.lime}"/>`;
    // Needle: a slim diamond, north half solid rock, south half outlined by the gap.
    s += `<path fill="${PALETTE.rock}" d="M0 ${-(r - 20)}L13 0L0 ${r - 20}L-13 0Z"/>`;
    s += `<path fill="${PALETTE.lime}" d="M0 ${r - 30}L6 4L-6 4Z"/>`;
    s += `</g>`;
  }
  return p.mirror ? `<g transform="matrix(-1 0 0 1 1024 0)">${s}</g>` : s;
}

const scaled = (inner, k) =>
  k === 1 ? inner : `<g transform="translate(512 512) scale(${k}) translate(-512 -512)">${inner}</g>`;
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${inner}</svg>`;

/** layer: "full" (iOS/web/legacy Android tile), "foreground" (adaptive, transparent), "background". */
export function render(seed, layer = "full") {
  if (layer === "background") return svg(`<rect width="1024" height="1024" fill="${PALETTE.sky}"/>`);
  const g = build(seed);
  if (layer === "foreground") return svg(foreground(g));
  return svg(`<rect width="1024" height="1024" fill="${PALETTE.sky}"/>${scaled(foreground(g), FULL_SCALE)}`);
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

function exportSeed(seed) {
  need("rsvg-convert");
  need("magick");
  const out = join(ROOT, "branding/logo/out", String(seed));
  rmSync(out, { recursive: true, force: true });
  const dir = (d) => (mkdirSync(join(out, d), { recursive: true }), join(out, d));

  const svgDir = dir("svg");
  const full = join(svgDir, "icon.svg");
  const fg = join(svgDir, "adaptive-foreground.svg");
  const bg = join(svgDir, "adaptive-background.svg");
  writeFileSync(full, render(seed, "full"));
  writeFileSync(fg, render(seed, "foreground"));
  writeFileSync(bg, render(seed, "background"));

  // Web: favicon, apple-touch, PWA manifest sizes. FULL_SCALE keeps the mark
  // inside the 40% maskable zone, so the "any" PNGs double as "maskable".
  const web = dir("web");
  writeFileSync(join(web, "icon.svg"), render(seed, "full"));
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

  writeFileSync(join(out, "params.json"), JSON.stringify(publicParams(seed), null, 2) + "\n");
  return out;
}

function publicParams(seed) {
  const { _r, ...rest } = params(seed);
  return rest;
}

// ---------------------------------------------------------------- candidate sheet

const dataUri = (s) => `data:image/svg+xml;base64,${Buffer.from(s).toString("base64")}`;

function sheetHtml(seeds) {
  const ink = PALETTE.rock;
  const card = (seed) => {
    const full = dataUri(render(seed, "full"));
    // Adaptive preview: background + foreground, cropped to the visible 72dp, then masked.
    const fgInner = foreground(build(seed));
    const adaptive = (mask) =>
      dataUri(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="170.67 170.67 682.67 682.67"><defs><clipPath id="m">${mask}</clipPath></defs><g clip-path="url(#m)"><rect width="1024" height="1024" fill="${PALETTE.sky}"/>${fgInner}</g></svg>`,
      );
    const circle = adaptive(`<circle cx="512" cy="512" r="341.33"/>`);
    const squircle = adaptive(`<rect x="170.67" y="170.67" width="682.67" height="682.67" rx="205"/>`);
    const guide = dataUri(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><circle cx="512" cy="512" r="${SAFE_R * FULL_SCALE}" fill="none" stroke="#ff2d55" stroke-width="3" stroke-dasharray="12 10"/></svg>`,
    );
    const ios = (s) => `<img src="${full}" width="${s}" height="${s}" style="border-radius:${s * 0.2237}px">`;
    const sizes = (bgc, fg) => `<div class="sizes" style="background:${bgc};color:${fg}">
        <figure>${ios(180)}<figcaption>180</figcaption></figure>
        <figure>${ios(60)}<figcaption>60</figcaption></figure>
        <figure>${ios(29)}<figcaption>29</figcaption></figure>
      </div>`;
    return `<section class="card">
      <header><b>seed ${seed}</b></header>
      <div class="row">
        <figure class="big"><div class="stack"><img src="${full}" width="300" height="300"><img class="guide" src="${guide}" width="300" height="300"></div><figcaption>1024 (shown 300) · dashed = mark safe radius</figcaption></figure>
        <div class="col">
          ${sizes("#f7f7f3", ink)}
          ${sizes("#121a21", "#e3eaf0")}
          <div class="sizes masks" style="background:#e8edef;color:${ink}">
            <figure>${ios(108)}<figcaption>iOS</figcaption></figure>
            <figure><img src="${circle}" width="108" height="108"><figcaption>Android circle</figcaption></figure>
            <figure><img src="${squircle}" width="108" height="108"><figcaption>Android squircle</figcaption></figure>
            <figure><img src="${circle}" width="48" height="48"><figcaption>48dp</figcaption></figure>
          </div>
        </div>
      </div>
    </section>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:24px;background:#fff;font:13px/1.3 -apple-system,"Helvetica Neue",Arial,sans-serif;color:${ink}}
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
    img{display:block}
  </style></head><body><h1>UCL Hiking Club · procedural mark candidates</h1><div class="grid">${seeds.map(card).join("")}</div></body></html>`;
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

function sheet(seeds, outPng) {
  const html = sheetHtml(seeds);
  const htmlPath = outPng.replace(/\.png$/, ".html");
  writeFileSync(htmlPath, html);
  const rows = Math.ceil(seeds.length / 2);
  const height = 24 + 40 + rows * 636 + 24;
  const profile = mkdtempSync(join(tmpdir(), "logo-chrome-"));
  sh(chrome(), [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    `--user-data-dir=${profile}`, `--window-size=1720,${height}`, `--screenshot=${outPng}`, `file://${htmlPath}`,
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

  if (flag("sheet")) {
    const seeds = parseSeeds(arg("seeds") ?? "1-12");
    const out = resolve(arg("out") ?? join(ROOT, "branding/logo/out/candidates.png"));
    mkdirSync(dirname(out), { recursive: true });
    const r = sheet(seeds, out);
    console.log(`sheet: ${r.png}\nhtml:  ${r.html}`);
    return;
  }

  const seedArg = arg("seed");
  if (seedArg === undefined || !/^\d+$/.test(seedArg)) {
    console.error("usage: generate.mjs --seed N [--layer full|foreground|background] [--out file.svg] [--params] [--export]\n       generate.mjs --sheet [--seeds 1-12] [--out sheet.png]");
    process.exit(1);
  }
  const seed = Number(seedArg);
  if (flag("params")) return console.log(JSON.stringify(publicParams(seed), null, 2));
  if (flag("export")) return console.log(`exported: ${exportSeed(seed)}`);
  const s = render(seed, arg("layer") ?? "full");
  const out = arg("out");
  if (out) writeFileSync(out, s + "\n");
  else process.stdout.write(s + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
