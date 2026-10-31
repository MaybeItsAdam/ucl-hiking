#!/usr/bin/env node
/**
 * Capture the store screenshots from the real app, running locally on demo data.
 *
 *   node scripts/store-assets/capture.mjs        # then: python3 scripts/store-assets/generate.py
 *
 * What it does, and what it never does:
 *
 * - Starts `next dev` on its own port with every Supabase variable blanked, so
 *   the app falls back to the in-memory dev store (src/lib/dev-store.ts). It
 *   refuses to run if a local .env file could hand the server real database
 *   credentials. No database is read or written.
 * - Seeds that dev store through DEV_FIXTURES: the invented walks, routes, kit
 *   and plan written by `fixtures()` below. Dates are relative to today, so the
 *   events list always has a "Next up".
 * - Signs a session cookie with a throwaway SESSION_SECRET for an invented
 *   Explorer member with no committee role, so no admin or preview UI shows.
 * - Drives the system Google Chrome (playwright-core, channel "chrome") at each
 *   store size in the light theme, then adds a 9:41 status bar and home
 *   indicator filled with the app's own bar colours. The results land in
 *   assets/store/captures/<device>/, which generate.py frames.
 *
 * Needs: Google Chrome, rsvg-convert and ImageMagick (`magick`), and network
 * access for the map tiles (OpenStreetMap/OpenTopoMap) and Google Fonts.
 */
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CAPTURES = path.join(ROOT, "assets/store/captures");
const PORT = Number(process.env.CAPTURE_PORT || 3123);
const ORIGIN = `http://localhost:${PORT}`;

// ---------------------------------------------------------------------------
// Devices: the store pixel size, the CSS viewport behind it, and the bars.
// ---------------------------------------------------------------------------

/** status/home are in CSS pixels; the page gets what is left between them. */
const DEVICES = [
  { dir: "ios", os: "ios", w: 1320, h: 2868, scale: 3, status: 54, home: 30, island: true },
  { dir: "ipad", os: "ios", w: 2064, h: 2752, scale: 2, status: 26, home: 22, island: false },
  { dir: "android", os: "android", w: 1080, h: 1920, scale: 3, status: 26, home: 18, island: false },
  { dir: "android-tablet-7", os: "android", w: 1200, h: 1920, scale: 2, status: 26, home: 20, island: false },
  { dir: "android-tablet-10", os: "android", w: 1600, h: 2560, scale: 2, status: 26, home: 20, island: false },
];

// ---------------------------------------------------------------------------
// Demo content. Invented walks, people and kit; real places and stations.
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

/** Midnight UTC on the Saturday `weeks` from this week's. */
function saturday(weeks, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7) + weeks * 7);
  return d;
}

/** A London wall-clock time on a date, as UTC (good enough for GMT/BST walks). */
function at(date, hhmm, offsetDays = 0) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(date.getTime() + offsetDays * DAY);
  const bst = (() => {
    const y = d.getUTCFullYear();
    const lastSun = (month) => {
      const x = new Date(Date.UTC(y, month + 1, 0));
      x.setUTCDate(x.getUTCDate() - x.getUTCDay());
      return x;
    };
    return d >= lastSun(2) && d < lastSun(9);
  })();
  d.setUTCHours(h - (bst ? 1 : 0), m, 0, 0);
  return d.toISOString();
}

const PLACES = {
  Seaford: [50.7726, 0.1008],
  Eastbourne: [50.7693, 0.281],
  Chesham: [51.7056, -0.6114],
  Rickmansworth: [51.6402, -0.4733],
  "Box Hill & Westhumble": [51.2541, -0.3289],
  Wendover: [51.7618, -0.7472],
  Lewes: [50.8706, 0.0113],
  Southease: [50.8312, 0.0306],
  Tring: [51.8008, -0.6227],
  Haslemere: [51.0886, -0.7193],
  Otford: [51.313, 0.196],
  Sevenoaks: [51.2768, 0.1817],
  Hassocks: [50.9246, -0.146],
  Brighton: [50.829, -0.141],
  Henley: [51.534, -0.9],
  "Princes Risborough": [51.7174, -0.8436],
  Amersham: [51.6744, -0.6075],
  Berkhamsted: [51.7633, -0.5617],
  Wye: [51.185, 0.929],
  Guildford: [51.237, -0.58],
  Gomshall: [51.2196, -0.4423],
  Dorking: [51.2408, -0.3242],
};

const GRADE_DOT = { Beginner: "🟢", Moderate: "🔵", Challenging: "🔴", Difficult: "⚫" };

function walkPost({ lead, km, ascent, grade, fare, minutes, start, finish }) {
  return [
    lead,
    "📐 DISTANCE:", `${km}km`,
    "🏔️ TOTAL ASCENT:", `${ascent}m`,
    "⚖️ DIFFICULTY:", `${grade} ${GRADE_DOT[grade]} (See Difficulty Grading Scale (🟢🔵🔴⚫) below)`,
    "💰 TRAIN TICKET COST:", "approx.", `£${fare}`, "with a", "16–25 Railcard (recommended)",
    "⏱️Expected Day Schedule :",
    "Morning departure from", "London Bridge", "Station (exact details after ticket sign-up).",
    "Around", String(minutes), "minutes travelling together to", start, ". Take the time to get to know others on the hike!",
    "Finish the hike near", finish, "station, return to London by early evening.",
    "🎒 WHAT TO BRING:",
    "Hiking boots 🥾 or good waterproof shoes/trainers you don’t mind getting muddy",
    "Raincoat 🌧️ / sunscreen 🌤️ depending on weather",
    "Packed lunch 🥪 and at least 1.5 litres of water 💧",
  ].join("\n");
}

/** [weeks from this Saturday, title, post fields] — negative weeks are done. */
const WALKS = [
  [-8, "🌻 Taster Walk (1 of 8): Lewes to Southease (12km)", { lead: "An easy first stretch of the South Downs Way, along the Ouse and up onto the chalk.", km: 12.4, ascent: 240, grade: "Beginner", fare: "18.40", minutes: 70, start: "Lewes", finish: "Southease" }],
  [-7, "🌳 Day Hike: Ivinghoe Beacon from Tring (17km)", { lead: "Beech woods, chalk grassland and the start of the Ridgeway.", km: 16.8, ascent: 390, grade: "Moderate", fare: "12.10", minutes: 45, start: "Tring", finish: "Tring" }],
  [-6, "🌲 Taster Walk (2 of 8): Chess Valley (16km)", { lead: "Watercress beds, water meadows and the gentlest river in the Chilterns.", km: 15.6, ascent: 180, grade: "Beginner", fare: "6.90", minutes: 50, start: "Chesham", finish: "Rickmansworth" }],
  [-5, "⛰️ Day Hike: Black Down from Haslemere (18km)", { lead: "The highest point in Sussex and a view across the Weald.", km: 18.2, ascent: 520, grade: "Challenging", fare: "16.80", minutes: 55, start: "Haslemere", finish: "Haslemere" }],
  [-4, "🍂 Taster Walk (3 of 8): Otford to Sevenoaks (14km)", { lead: "North Downs ridges and Knole Park's deer in their autumn coats.", km: 13.9, ascent: 310, grade: "Moderate", fare: "9.20", minutes: 35, start: "Otford", finish: "Sevenoaks" }],
  [-3, "🌊 Day Hike: Devil’s Dyke, Hassocks to Brighton (19km)", { lead: "Along the top of the Downs to the dry valley, then down to the sea.", km: 19.1, ascent: 430, grade: "Challenging", fare: "19.60", minutes: 60, start: "Hassocks", finish: "Brighton" }],
  [-2, "🌳 Day Hike: Coombe Hill from Wendover (15km)", { lead: "Chiltern beechwoods at their best and the monument on Coombe Hill.", km: 14.7, ascent: 350, grade: "Moderate", fare: "13.30", minutes: 50, start: "Wendover", finish: "Wendover" }],
  [-1, "🍁 Taster Walk (4 of 8): Gomshall to Dorking (17km)", { lead: "Over the Surrey Hills by St Martha’s and Ranmore Common.", km: 16.5, ascent: 410, grade: "Moderate", fare: "11.70", minutes: 50, start: "Gomshall", finish: "Dorking" }],
  [1, "🌲 Taster Walk (5 of 8): Chess Valley Circular (13km)", { lead: "Back to the Chess for a shorter loop through Latimer and Chenies.", km: 13.2, ascent: 160, grade: "Beginner", fare: "6.90", minutes: 50, start: "Amersham", finish: "Amersham" }],
  [2, "🌊 Day Hike: Seven Sisters (22km)", { lead: "The club’s favourite: the chalk cliffs from Cuckmere Haven to Beachy Head, with the sea on your right the whole way.", km: 21.9, ascent: 501, grade: "Difficult", fare: "31.65", minutes: 99, start: "Seaford", finish: "Eastbourne" }],
  [3, "⛰️ Day Hike: Box Hill Circular (14km)", { lead: "Up the stepping stones, over Box Hill and round by Juniper Top.", km: 14.2, ascent: 460, grade: "Challenging", fare: "10.40", minutes: 45, start: "Box Hill & Westhumble", finish: "Box Hill & Westhumble" }],
  [4, "🌳 Day Hike: Ridgeway, Princes Risborough to Wendover (18km)", { lead: "Whiteleaf Cross, Coombe Hill and the long views west over the Vale.", km: 17.6, ascent: 420, grade: "Moderate", fare: "14.20", minutes: 55, start: "Princes Risborough", finish: "Wendover" }],
  [6, "🎄 Taster Walk (6 of 8): Berkhamsted Common (12km)", { lead: "A wintry loop over the common and through Ashridge before mince pies.", km: 12.1, ascent: 210, grade: "Beginner", fare: "10.80", minutes: 40, start: "Berkhamsted", finish: "Berkhamsted" }],
];

const SOCIALS = [
  [2, 3, "19:00", "21:30", "🍻 Social: Pub quiz", "The Marlborough Arms", "Teams of six, a round on maps and a prize for the best team name."],
  [3, 3, "18:30", "20:30", "🩹 Club: Outdoor first aid workshop", "Roberts Building, UCL", "Two hours on what to do when someone goes over on an ankle miles from a road."],
  [5, 5, "19:00", "23:00", "🎄 Social: Christmas dinner", "The Lamb, Lamb’s Conduit Street", "Three courses, crackers and the year’s walk awards."],
];

/** A believable track: control points joined at ~70 m, with a little wander. */
function track(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const dist = Math.hypot((b[0] - a[0]) * 111_000, (b[1] - a[1]) * 70_000);
    const steps = Math.max(2, Math.round(dist / 70));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const wobble = Math.sin((i * 7 + s) * 0.9) * 0.00012;
      out.push([
        +(a[0] + (b[0] - a[0]) * t + wobble).toFixed(6),
        +(a[1] + (b[1] - a[1]) * t - wobble).toFixed(6),
        Math.round(a[2] + (b[2] - a[2]) * t + Math.sin(s * 0.7) * 2),
      ]);
    }
  }
  out.push(points.at(-1));
  return out;
}

// Seaford, over Seaford Head, Cuckmere Haven, the Seven Sisters, Birling Gap,
// Belle Tout, Beachy Head and down into Eastbourne.
const SEVEN_SISTERS_LINE = [
  [50.7726, 0.1008, 8], [50.7672, 0.1103, 22], [50.7621, 0.1196, 78], [50.7603, 0.1338, 60], [50.7624, 0.1452, 6],
  [50.7612, 0.1532, 5], [50.7578, 0.1588, 58], [50.7552, 0.1650, 72], [50.7536, 0.1712, 38], [50.7520, 0.1771, 77],
  [50.7499, 0.1832, 45], [50.7478, 0.1890, 70], [50.7459, 0.1952, 52], [50.7424, 0.2003, 18], [50.7400, 0.2095, 80],
  [50.7384, 0.2143, 92], [50.7369, 0.2259, 120], [50.7353, 0.2423, 162], [50.7426, 0.2548, 120], [50.7550, 0.2687, 40],
  [50.7652, 0.2785, 12], [50.7693, 0.2810, 9],
];

/**
 * An invented route for a demo walk that has no drawn one: a gentle arc from
 * start to finish, or a loop of about the right length for a circular. Only
 * so the year map has lines to draw; nobody walks these.
 */
function sketchRoute(start, finish, km, seed) {
  const [a, b] = [PLACES[start], PLACES[finish]];
  const pts = [];
  const N = 14;
  if (start === finish) {
    const r = km / (2 * Math.PI);
    const dir = (seed * 1.7) % (2 * Math.PI);
    const c = [a[0] + (r / 111) * Math.sin(dir), a[1] + (r / 70) * Math.cos(dir)];
    for (let i = 0; i <= N; i++) {
      const t = dir + Math.PI + (i / N) * 2 * Math.PI;
      const rr = r * (1 + 0.18 * Math.sin(i * 1.3 + seed));
      pts.push([c[0] + (rr / 111) * Math.sin(t), c[1] + (rr / 70) * Math.cos(t), 80 + 60 * Math.sin(i + seed)]);
    }
    pts[0] = [...a, 80];
    pts[N] = [...a, 80];
  } else {
    const [dy, dx] = [b[0] - a[0], b[1] - a[1]];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const bow = Math.sin(Math.PI * t) * 0.12 * (seed % 2 ? 1 : -1) + Math.sin(t * 9 + seed) * 0.015;
      pts.push([a[0] + dy * t - dx * bow * 0.6, a[1] + dx * t + dy * bow * 1.6, 60 + 90 * Math.sin(Math.PI * t)]);
    }
  }
  return pts;
}

function fixtures(memberId) {
  const now = new Date();
  const synced = now.toISOString();
  const events = [];
  let n = 0;
  const id = () => `demo-event-${String(++n).padStart(2, "0")}`;

  for (const [weeks, title, post] of WALKS) {
    const day = saturday(weeks, now);
    const eventId = id();
    events.push({
      id: eventId,
      suu_event_id: `demo-su-${eventId}`,
      title,
      starts_at: at(day, "08:30"),
      ends_at: at(day, "18:30"),
      location: "The Great Outdoors",
      status: weeks < 0 ? "completed" : weeks === 2 ? "upcoming" : weeks === 3 ? "sold_out" : "upcoming",
      capacity: 40,
      tickets_sold: weeks === 3 ? 40 : 18 + ((weeks * 7) % 15),
      price_pence: 300,
      source_reference: null,
      synced_at: synced,
      description: walkPost(post),
      location_url: null,
      image_url: null,
      is_all_day: false,
      source: "demo",
    });
  }
  for (const [weeks, offset, start, end, title, location, lead] of SOCIALS) {
    const day = saturday(weeks, now);
    events.push({
      id: id(),
      suu_event_id: null,
      title,
      starts_at: at(day, start, offset - 6),
      ends_at: at(day, end, offset - 6),
      location,
      status: "upcoming",
      capacity: 60,
      tickets_sold: 25,
      price_pence: 0,
      source_reference: null,
      synced_at: synced,
      description: lead,
      location_url: null,
      image_url: null,
      is_all_day: false,
      source: "demo",
    });
  }
  events.sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  const sisters = events.find((e) => e.title.includes("Seven Sisters"));
  const segments = [track(SEVEN_SISTERS_LINE)];
  const routes = [
    {
      event_suu_id: sisters.suu_event_id,
      name: "Seven Sisters: Seaford to Eastbourne",
      source_file: "seven-sisters.gpx",
      source_url: null,
      distance_m: 21_850,
      ascent_m: 501,
      descent_m: 500,
      segments,
      waypoints: [
        { lat: 50.7612, lng: 0.1532, name: "Cuckmere Haven" },
        { lat: 50.7424, lng: 0.2003, name: "Birling Gap" },
        { lat: 50.7353, lng: 0.2423, name: "Beachy Head" },
      ],
      source: "upload",
      osmaps_route_id: null,
      updated_at: synced,
    },
  ];
  WALKS.forEach(([, title, post], i) => {
    const event = events.find((e) => e.title === title);
    if (event === sisters || !PLACES[post.start] || !PLACES[post.finish]) return;
    routes.push({
      event_suu_id: event.suu_event_id,
      name: title,
      source_file: null,
      source_url: null,
      distance_m: Math.round(post.km * 1000),
      ascent_m: post.ascent,
      descent_m: post.ascent,
      segments: [track(sketchRoute(post.start, post.finish, post.km, i + 1))],
      waypoints: [],
      source: "upload",
      osmaps_route_id: null,
      updated_at: synced,
    });
  });
  const sistersDay = new Date(sisters.starts_at);
  const plans = [
    {
      event_suu_id: sisters.suu_event_id,
      leader_member_id: "demo-leader",
      backmarker_member_id: "demo-backmarker",
      meet_at: at(new Date(Date.UTC(sistersDay.getUTCFullYear(), sistersDay.getUTCMonth(), sistersDay.getUTCDate())), "08:15"),
      meet_point: "London Bridge, under the departures board",
      transport: "Southern to Seaford, changing at Lewes",
      kit_list: ["Boots or trail shoes", "Waterproof jacket", "Packed lunch", "2 litres of water", "16–25 Railcard"],
      route_url: null,
      booking_url: null,
      notes: "Lunch on the shingle at Birling Gap. The cliff edge is unfenced and crumbling, so stay on the path.",
      leader: { id: "demo-leader", full_name: "Maya Collins" },
      backmarker: { id: "demo-backmarker", full_name: "Tom Hartley" },
    },
  ];

  const kit = [
    ["Lightweight 2-person tent", "Tents", "Vango Banshee 200. Pitches inner-first, 2.3 kg.", 6, 4, "good"],
    ["3-season sleeping bag", "Sleeping", "Comfort to 2 °C. Comes with a compression sack.", 10, 7, "good"],
    ["Self-inflating sleeping mat", "Sleeping", "Full length, 3.8 cm thick.", 10, 8, "excellent"],
    ["Trekking poles (pair)", "Walking", "Adjustable aluminium, flick-lock.", 12, 9, "good"],
    ["Waterproof jacket", "Clothing", "Sizes S to XL. Ask for your size in the notes.", 8, 3, "fair"],
    ["Gaiters (pair)", "Clothing", "One size. For the muddy weeks.", 10, 10, "good"],
    ["Gas stove and pan set", "Cooking", "Burner, two pans and a windshield. Gas not included.", 5, 4, "good"],
    ["Head torch", "Safety", "200 lumens, rechargeable over USB-C.", 15, 11, "excellent"],
    ["Group shelter", "Safety", "Bothy bag for 4–6 people.", 3, 3, "good"],
    ["OS Explorer map set", "Navigation", "South Downs, Chilterns and Surrey Hills sheets.", 6, 5, "good"],
    ["Compass", "Navigation", "Silva baseplate with romer scales.", 12, 12, "excellent"],
    ["Microspikes", "Walking", "For icy trails. Sizes S, M and L.", 8, 0, "good"],
  ];
  const equipment = kit.map(([name, category, description, total, available, condition], i) => ({
    id: `demo-kit-${i + 1}`,
    name,
    category,
    description,
    total_quantity: total,
    available_quantity: available,
    condition,
    created_at: synced,
    updated_at: synced,
  }));
  const loanStart = new Date(sistersDay.getTime() - DAY).toISOString().slice(0, 10);
  const loanEnd = new Date(sistersDay.getTime() + 2 * DAY).toISOString().slice(0, 10);
  const requests = [
    {
      id: "demo-request-1",
      member_id: memberId,
      equipment_id: "demo-kit-4",
      quantity: 1,
      start_date: loanStart,
      end_date: loanEnd,
      purpose: "Seven Sisters day hike",
      status: "approved",
      notes: null,
      reviewed_by: null,
      reviewed_at: synced,
      created_at: synced,
      updated_at: synced,
    },
  ];

  return { events, routes, plans, places: PLACES, equipment, requests };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const DB_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL", "POSTGRES_URL", "SUPABASE_DB_URL"];

function refuseRealCredentials() {
  for (const name of [".env", ".env.local", ".env.development", ".env.development.local"]) {
    const file = path.join(ROOT, name);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const hit = DB_VARS.find((v) => new RegExp(`^\\s*${v}\\s*=\\s*\\S`, "m").test(text));
    if (hit) {
      throw new Error(`${name} sets ${hit}. Move it aside before capturing: the screenshots must not run against a real database.`);
    }
  }
}

async function startServer(fixtureFile, secret) {
  const env = { ...process.env, NODE_ENV: "development", DEV_FIXTURES: fixtureFile, SESSION_SECRET: secret, NEXT_TELEMETRY_DISABLED: "1" };
  for (const v of DB_VARS) delete env[v];
  delete env.DOPPLER_TOKEN;
  const child = spawn(path.join(ROOT, "node_modules/.bin/next"), ["dev", "--webpack", "-p", String(PORT)], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => process.env.CAPTURE_VERBOSE && process.stdout.write(d));
  child.stderr.on("data", (d) => process.stderr.write(d));
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${ORIGIN}/`, { redirect: "manual" });
      if (res.status) return child;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  child.kill();
  throw new Error("next dev did not start");
}

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function pixel(file, x, y) {
  return "#" + execFileSync("magick", [file, "-format", `%[hex:p{${x},${y}}]`, "info:"], { encoding: "utf8" }).trim().slice(0, 6).toLowerCase();
}

/** The status bar as SVG at device pixels: 9:41, then signal, wifi and battery. */
function statusBarSvg(device, fill) {
  const { w, scale: k } = device;
  const h = device.status * k;
  const ink = luminance(fill) > 0.55 ? "#1c1a23" : "#ffffff";
  const ios = device.os === "ios";
  const cy = ios && device.island ? h * 0.55 : h / 2;
  const fs = (ios ? 17 : 14) * k;
  const timeX = ios ? (device.island ? w * 0.16 : 22 * k) : 16 * k;
  const right = w - (ios ? (device.island ? w * 0.09 : 22 * k) : 16 * k);
  const u = k; // one CSS pixel
  const battery = `<g transform="translate(${right - 26 * u} ${cy - 6 * u})">
      <rect x="0.5" y="0.5" width="${23 * u}" height="${12 * u}" rx="${3.5 * u}" fill="none" stroke="${ink}" stroke-opacity=".45" stroke-width="${u}"/>
      <rect x="${2 * u}" y="${2 * u}" width="${18 * u}" height="${9 * u}" rx="${2 * u}" fill="${ink}"/>
      <rect x="${24.5 * u}" y="${4 * u}" width="${1.6 * u}" height="${4.5 * u}" rx="${0.8 * u}" fill="${ink}" fill-opacity=".45"/>
    </g>`;
  const wifiX = right - 48 * u;
  const wifi = `<g transform="translate(${wifiX} ${cy + 5 * u})" fill="${ink}">
      <path d="M0 0 L${-3.2 * u} ${-3.4 * u} A${4.6 * u} ${4.6 * u} 0 0 1 ${3.2 * u} ${-3.4 * u} Z"/>
      <path d="M${-5.2 * u} ${-5.4 * u} A${7.4 * u} ${7.4 * u} 0 0 1 ${5.2 * u} ${-5.4 * u} L${4 * u} ${-4.1 * u} A${5.7 * u} ${5.7 * u} 0 0 0 ${-4 * u} ${-4.1 * u} Z"/>
      <path d="M${-7.6 * u} ${-7.7 * u} A${10.8 * u} ${10.8 * u} 0 0 1 ${7.6 * u} ${-7.7 * u} L${6.3 * u} ${-6.4 * u} A${9 * u} ${9 * u} 0 0 0 ${-6.3 * u} ${-6.4 * u} Z"/>
    </g>`;
  const barsX = wifiX - 30 * u;
  const signal = [0, 1, 2, 3]
    .map((i) => `<rect x="${barsX + i * 4.6 * u}" y="${cy + 5 * u - (4 + i * 2.6) * u}" width="${3 * u}" height="${(4 + i * 2.6) * u}" rx="${0.8 * u}" fill="${ink}"/>`)
    .join("");
  const island = device.island
    ? `<rect x="${w / 2 - 63 * u}" y="${11 * u}" width="${126 * u}" height="${37 * u}" rx="${18.5 * u}" fill="#000"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="${fill}"/>
    ${island}
    <text x="${timeX}" y="${cy}" dominant-baseline="central" fill="${ink}" font-family="-apple-system, 'SF Pro Text', Roboto, Helvetica, Arial, sans-serif" font-size="${fs}" font-weight="600">9:41</text>
    ${signal}${wifi}${battery}
  </svg>`;
}

function homeBarSvg(device, fill) {
  const { w, scale: k } = device;
  const h = device.home * k;
  const ink = luminance(fill) > 0.55 ? "#1c1a23" : "#ffffff";
  const bw = (device.os === "ios" ? 140 : 108) * k;
  const bh = (device.os === "ios" ? 5 : 4) * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="${fill}"/>
    <rect x="${(w - bw) / 2}" y="${h - bh - (device.os === "ios" ? 8 : 6) * k}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="${ink}" fill-opacity=".85"/>
  </svg>`;
}

function compose(device, shot, out, work) {
  const top = pixel(shot, 4, 2);
  const shotH = Number(execFileSync("magick", ["identify", "-format", "%h", shot], { encoding: "utf8" }));
  const bottom = pixel(shot, 4, shotH - 2);
  const svgs = [
    [path.join(work, "status.svg"), statusBarSvg(device, top), device.status * device.scale],
    [path.join(work, "home.svg"), homeBarSvg(device, bottom), device.home * device.scale],
  ];
  const pngs = svgs.map(([svg, body, h]) => {
    writeFileSync(svg, body);
    const png = svg.replace(/\.svg$/, ".png");
    execFileSync("rsvg-convert", ["-w", String(device.w), "-h", String(h), svg, "-o", png]);
    return png;
  });
  mkdirSync(path.dirname(out), { recursive: true });
  execFileSync("magick", [pngs[0], shot, pngs[1], "-append", "-alpha", "off", "-type", "TrueColor", out]);
  const size = execFileSync("magick", ["identify", "-format", "%w %h", out], { encoding: "utf8" }).trim();
  if (size !== `${device.w} ${device.h}`) throw new Error(`${out}: ${size}, expected ${device.w} ${device.h}`);
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

const HIDE_DEV_UI = `
  nextjs-portal, [data-nextjs-toast], [data-next-badge-root], #__next-build-watcher { display: none !important; }
  *, *::before, *::after { caret-color: transparent !important; }
  .leaflet-control-attribution { font-size: 9px !important; }
`;

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  // Leaflet tiles: wait until every visible tile image has loaded.
  await page
    .waitForFunction(() => [...document.querySelectorAll(".leaflet-tile")].every((img) => img.complete && img.naturalWidth > 0), null, { timeout: 30_000 })
    .catch(() => {});
  await page.waitForTimeout(1200);
}

/**
 * Scroll just far enough that the bottom of `selector` clears the tab bar:
 * on a phone the walk page then shows The day and the whole route map.
 */
/**
 * Scroll so `selector` sits just under the app's title bar: past the page
 * heading and back link, so a phone shows more of the page itself.
 */
async function scrollUnderTitleBar(page, selector) {
  await page.evaluate((sel) => {
    const target = document.querySelector(sel);
    if (!target) return;
    const bar = document.querySelector(".app-titlebar");
    const top = target.getBoundingClientRect().top + window.scrollY - (bar ? bar.getBoundingClientRect().height : 0) - 12;
    window.scrollTo(0, Math.max(0, top));
  }, selector);
}

async function scrollToShowBottomOf(page, selector) {
  await page.evaluate((sel) => {
    const target = document.querySelector(sel);
    if (!target) return;
    const tabs = document.querySelector(".app-tabs");
    const tabsTop = tabs && getComputedStyle(tabs).position === "fixed" ? tabs.getBoundingClientRect().top : window.innerHeight;
    const overflow = target.getBoundingClientRect().bottom - (tabsTop - 16);
    if (overflow > 0) window.scrollTo(0, window.scrollY + overflow);
  }, selector);
}

/** Each screen: where to go, and anything to do before the shot. */
function screens(sistersId) {
  return [
    { name: "01-events", url: "/portal/events" },
    { name: "02-walk", url: `/portal/events/${sistersId}`, prepare: (page) => scrollUnderTitleBar(page, ".event-hero") },
    { name: "03-year-map", url: "/portal/events/map", prepare: (page) => scrollToShowBottomOf(page, ".walkmap-page .hike-map-wrap") },
    { name: "04-kit", url: "/portal/equipment" },
    { name: "05-navigator", url: "/portal/navigator" },
  ];
}

async function main() {
  refuseRealCredentials();
  const work = mkdtempSync(path.join(tmpdir(), "ucl-hiking-store-"));
  const member = {
    toolboxUserId: "demo-toolbox-user",
    memberId: "demo-member",
    email: "demo.member@example.com",
    name: "Alex Morgan",
    membershipTierAtSignIn: "explorer",
    governanceRoleAtSignIn: null,
    wasWalkLeaderAtSignIn: false,
  };
  const data = fixtures(member.memberId);
  const fixtureFile = path.join(work, "fixtures.json");
  writeFileSync(fixtureFile, JSON.stringify(data, null, 2));
  const sistersId = data.events.find((e) => e.title.includes("Seven Sisters")).id;

  const secret = randomBytes(48).toString("base64");
  const token = await new SignJWT({ ...member })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(secret));

  console.log(`Starting next dev on ${ORIGIN} with demo fixtures (${work})`);
  const server = await startServer(fixtureFile, secret);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const only = process.argv.slice(2);
    for (const device of DEVICES.filter((d) => !only.length || only.includes(d.dir))) {
      const viewport = { width: device.w / device.scale, height: device.h / device.scale - device.status - device.home };
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: device.scale,
        isMobile: viewport.width < 700,
        hasTouch: true,
        colorScheme: "light",
        reducedMotion: "reduce",
        locale: "en-GB",
        timezoneId: "Europe/London",
      });
      await context.addCookies([{ name: "ucl_hiking_session", value: token, url: ORIGIN, httpOnly: true, sameSite: "Lax" }]);
      await context.addInitScript(() => {
        try {
          localStorage.clear();
        } catch {}
      });
      const page = await context.newPage();
      for (const screen of screens(sistersId)) {
        await page.goto(ORIGIN + screen.url, { waitUntil: "domcontentloaded", timeout: 180_000 });
        await page.addStyleTag({ content: HIDE_DEV_UI });
        await settle(page);
        if (screen.prepare) {
          await screen.prepare(page);
          await settle(page);
        }
        const shot = path.join(work, `${device.dir}-${screen.name}.png`);
        await page.screenshot({ path: shot });
        const out = path.join(CAPTURES, device.dir, `${screen.name}.png`);
        compose(device, shot, out, work);
        console.log(`  ${path.relative(ROOT, out)}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
