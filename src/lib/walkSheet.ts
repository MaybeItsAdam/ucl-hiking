import { eventKind, type EventKind } from "@/lib/eventDetails";
import type { MembershipTier } from "@/lib/access";

/**
 * The club's programme lives in Google Sheets, and the app reads and edits it
 * there rather than keeping a copy of its own.
 *
 * The committee calendar ("Main Calendar" tab) has one row per event. Most of
 * its columns are formulas: a hike's name, distance, meeting time, ticket cost
 * and OS link come from its row in "Hike Planning + HTML", and the walk
 * leaders come from the WL calendar's sign-up columns. So each detail the app
 * can edit names the one cell a person would type it into, and the app never
 * writes a formula's cell.
 *
 * Everything here is pure: the sheet comes in as rows of formatted strings
 * (plus formulas where it matters), and out come walks and cell addresses.
 */

/** The club's calendar spreadsheets, owned by uclhiking@gmail.com. */
export const WALK_SHEETS = {
  main: process.env.WALK_SHEET_ID || "16MiP5dUeHTlARhZnr907YlssCcGi5_51Eq-QmsOP0q8",
  leaders: process.env.WL_SHEET_ID || "1ZTBj6SIUDf2vBzHbXm2Kdjx4uPNMweUasSc-OW5m1jw",
} as const;

export const TABS = {
  main: "Main Calendar",
  planning: "Hike Planning + HTML",
  signups: "Walk/Hike Calendar",
  roster: "WL Roster (app)",
} as const;

/** Developer-metadata key that tags each calendar row with its walk's id; it moves with the row. */
export const ROW_KEY = "uclh";

// ---------------------------------------------------------------------------
// Visibility

/** Who can see a walk: a ladder, each rung seeing everything below it. */
export const VISIBILITY = ["public", "taster", "member", "explorer", "leaders", "committee"] as const;
export type Visibility = (typeof VISIBILITY)[number];

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  public: "Public",
  taster: "Tasters",
  member: "Members",
  explorer: "Explorers",
  leaders: "Walk leaders",
  committee: "Committee",
};

export function isVisibility(value: unknown): value is Visibility {
  return typeof value === "string" && VISIBILITY.includes(value as Visibility);
}

const TIER_RANK: Record<MembershipTier, number> = { taster: 1, standard: 2, explorer: 3 };
const VIS_RANK: Record<Visibility, number> = { public: 0, taster: 1, member: 2, explorer: 3, leaders: 4, committee: 5 };

export interface Viewer {
  tier: MembershipTier | null;
  isLeader: boolean;
  isCommittee: boolean;
}

/** Whether a viewer sees a walk. Committee sees everything, including what isn't published. */
export function canSee(walk: { published: boolean; visibility: Visibility }, viewer: Viewer): boolean {
  if (viewer.isCommittee) return true;
  if (!walk.published) return false;
  if (walk.visibility === "committee") return false;
  if (walk.visibility === "leaders") return viewer.isLeader;
  if (viewer.isLeader) return true;
  const rank = viewer.tier ? TIER_RANK[viewer.tier] : 0;
  return VIS_RANK[walk.visibility] <= rank;
}

/** The sheet's MEMBERSHIP column, as a starting visibility. */
export function visibilityFromMembership(text: string): Visibility {
  const t = text.trim().toLowerCase();
  if (!t || t === "all" || t.startsWith("taster")) return "taster";
  if (t.startsWith("public") || t.startsWith("everyone")) return "public";
  if (t.startsWith("discover") || t === "ds" || t.startsWith("member") || t.startsWith("standard")) return "member";
  if (t.startsWith("explor") || t === "xp") return "explorer";
  if (t.startsWith("wl") || t.includes("leader")) return "leaders";
  if (t.startsWith("committee")) return "committee";
  return "taster";
}

// ---------------------------------------------------------------------------
// Cells and headers

/** Lowercased first line of a header, emoji and punctuation gone: "DATE 🗓️" → "date". */
export function headerKey(text: string): string {
  return text
    .split("\n")[0]
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[^a-z0-9£()+/?& -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The column whose header starts with any of `prefixes`, or -1. */
export function findColumn(header: string[], ...prefixes: string[]): number {
  const keys = header.map(headerKey);
  for (const p of prefixes) {
    const i = keys.findIndex((k) => k.startsWith(p));
    if (i >= 0) return i;
  }
  return -1;
}

/** The first row (0-based) that looks like the main calendar's header. */
export function findHeaderRow(rows: string[][], required: string[]): number {
  return rows.findIndex((row) => {
    const keys = row.map(headerKey);
    return required.every((r) => keys.some((k) => k.startsWith(r)));
  });
}

/** "3/10/26", "03/10/2026", "Sat 25/07/26 - Wed 29/07/26" → "2026-10-03" (the first date). */
export function parseSheetDate(text: string): string | null {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "2026-10-03" → "03/10/2026", as the sheet (UK locale) parses typed dates. */
export function sheetDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function parseNumber(text: string): number | null {
  const n = Number(text.replace(/[£,\s]/g, "").replace(/km$|m$/i, ""));
  return text.trim() && Number.isFinite(n) ? n : null;
}

/** '=\'Hike Planning + HTML\'!A103' → 103. */
export function planningRowOf(formula: string): number | null {
  const m = formula.match(/^=\s*'?Hike Planning \+ HTML'?!\$?A\$?(\d+)\s*$/i);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Fields the app can edit

export type FieldHome = "main" | "planning" | "signups";

export interface FieldDef {
  key: string;
  label: string;
  home: FieldHome;
  /** Header prefixes (see headerKey) to find the column by. */
  headers: string[];
  /** Only on walks with a planning row (a hike or walk). */
  walkOnly?: boolean;
  /** Only on rows without one (a social, a trip). */
  eventOnly?: boolean;
  kind?: "text" | "date" | "number" | "url" | "long" | "membership";
}

/**
 * Each editable detail and the column a person types it into. Hikes keep
 * their details on the planning tab; a social's are on the calendar row.
 */
export const FIELDS: FieldDef[] = [
  { key: "date", label: "Date", home: "main", headers: ["date"], kind: "date" },
  { key: "name", label: "Name", home: "main", headers: ["event name"], eventOnly: true },
  { key: "hikeName", label: "Route name", home: "planning", headers: ["what is the name of the hike"], walkOnly: true },
  { key: "eventLead", label: "Event lead", home: "main", headers: ["event lead"] },
  { key: "venue", label: "Venue", home: "main", headers: ["venue"] },
  { key: "membership", label: "Membership (sheet)", home: "main", headers: ["membership"], kind: "membership" },
  { key: "suLink", label: "SU event link", home: "main", headers: ["su event link"], kind: "url" },
  { key: "notes", label: "Notes", home: "main", headers: ["notes"], kind: "long" },
  { key: "distanceKm", label: "Distance (km)", home: "planning", headers: ["how long is the hike"], walkOnly: true, kind: "number" },
  { key: "ascentM", label: "Ascent (m)", home: "planning", headers: ["how much ascent"], walkOnly: true, kind: "number" },
  { key: "grade", label: "Grade", home: "planning", headers: ["what is the difficulty grade"], walkOnly: true },
  { key: "paths", label: "Paths", home: "planning", headers: ["what will the paths be like"], walkOnly: true },
  { key: "osLink", label: "OS Maps link", home: "planning", headers: ["os maps link"], walkOnly: true, kind: "url" },
  { key: "ticketPrice", label: "Ticket cost", home: "planning", headers: ["how expensive is the travel ticket"], walkOnly: true },
  { key: "outboundStation", label: "London station", home: "planning", headers: ["what is the outbound london station"], walkOnly: true },
  { key: "firstTrain", label: "First train", home: "planning", headers: ["what time is the (1st) outbound train"], walkOnly: true },
  { key: "startStation", label: "Start station", home: "planning", headers: ["what station will the hike start at"], walkOnly: true },
  { key: "endStation", label: "End station", home: "planning", headers: ["what station does the hike end at"], walkOnly: true },
  { key: "description", label: "Description", home: "planning", headers: ["please give a 2-3 sentence description"], walkOnly: true, kind: "long" },
  { key: "leader1", label: "Primary walk leader", home: "signups", headers: ["primary wl"], walkOnly: true },
  { key: "leader2", label: "Walk leader 2", home: "signups", headers: ["walk leader 2"], walkOnly: true },
  { key: "leader3", label: "Walk leader 3", home: "signups", headers: ["walk leader 3"], walkOnly: true },
  { key: "leader4", label: "Walk leader 4", home: "signups", headers: ["walk leader 4"], walkOnly: true },
  { key: "leader5", label: "Walk leader 5", home: "signups", headers: ["walk leader 5"], walkOnly: true },
  { key: "leader6", label: "Walk leader 6", home: "signups", headers: ["walk leader 6"], walkOnly: true },
  { key: "extraLeaders", label: "Additional leaders", home: "signups", headers: ["additional leaders"], walkOnly: true },
  { key: "shadowing", label: "Shadowing", home: "signups", headers: ["new leaders"], walkOnly: true },
];

export const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

/** Shown on a walk but worked out by the sheet, so never written. */
export const READ_ONLY = [
  { key: "status", headers: ["status"] },
  { key: "meetTime", headers: ["meeting time"] },
  { key: "meetPlace", headers: ["meeting location"] },
  { key: "ticketCost", headers: ["ticket cost"] },
  { key: "osLinkShown", headers: ["os link"] },
  { key: "routeName", headers: ["route link"] },
  { key: "distanceShown", headers: ["distance"] },
  { key: "ascentShown", headers: ["elevation"] },
  { key: "gradeShown", headers: ["score"] },
  { key: "ticketsSold", headers: ["tickets sold"] },
  { key: "firstAider", headers: ["first aider"] },
  { key: "mainLeader2", headers: ["walk leader 2"] },
  { key: "mainLeader3", headers: ["walk leader 3"] },
  { key: "mainLeader4", headers: ["walk leader 4"] },
  { key: "mainLeader5", headers: ["walk leader 5"] },
  { key: "mainLeader6", headers: ["walk leader 6"] },
  { key: "mainExtraLeaders", headers: ["additional leaders"] },
  { key: "mainShadowing", headers: ["new leaders"] },
] as const;

export type Values = Record<string, string>;

/** Turn an edit from the app into what's typed into the cell, or say why not. */
export function cellText(field: FieldDef, raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const value = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
  if (value.length > 4000) return { ok: false, error: `${field.label} is too long.` };
  if (field.kind === "date") {
    if (!value) return { ok: false, error: "A walk needs a date." };
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : parseSheetDate(value);
    return iso ? { ok: true, text: sheetDate(iso) } : { ok: false, error: "The date isn't a date." };
  }
  if (field.kind === "number" && value && parseNumber(value) === null) return { ok: false, error: `${field.label} must be a number.` };
  if (field.kind === "url" && value) {
    try {
      const u = new URL(value);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    } catch {
      return { ok: false, error: `${field.label} must be a link starting https://.` };
    }
  }
  // A leading = would be typed in as a formula.
  return { ok: true, text: value.startsWith("=") ? `'${value}` : value };
}

/** Two cell texts that mean the same (the sheet may reformat "03/10/2026" as "3/10/26"). */
export function sameValue(field: FieldDef | undefined, a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  if (field?.kind === "date") return parseSheetDate(a) !== null && parseSheetDate(a) === parseSheetDate(b);
  if (field?.kind === "number") return parseNumber(a) !== null && parseNumber(a) === parseNumber(b);
  return false;
}

// ---------------------------------------------------------------------------
// Rows

export interface Layout {
  headerRow: number;
  columns: Record<string, number>;
}

/** Columns by key, for one tab's header row. */
export function layoutOf(header: string[], home: FieldHome | "readonly"): Record<string, number> {
  const columns: Record<string, number> = {};
  const defs = home === "readonly" ? READ_ONLY : FIELDS.filter((f) => f.home === home);
  for (const def of defs) {
    const i = findColumn(header, ...def.headers);
    if (i >= 0) columns[def.key] = i;
  }
  return columns;
}

export interface SheetWalk {
  /** 1-based sheet row on the calendar tab. */
  row: number;
  /** From the row's developer metadata, once tagged. */
  key: string | null;
  date: string | null;
  title: string;
  kind: EventKind;
  /** 1-based row on the planning tab, for hikes. */
  planningRow: number | null;
  /** Editable values, by field key. */
  values: Values;
  /** Worked-out values, for display. */
  shown: Values;
}

/**
 * Calendar rows that are events: below the header, with a date and a name.
 * Week markers ("Week 3" with nothing else) and "TBC" dates are skipped.
 */
export function readCalendar(
  rows: string[][],
  formulas: string[][],
  keys: (string | null)[],
): { layout: Layout; readonly: Record<string, number>; walks: SheetWalk[] } | null {
  const headerRow = findHeaderRow(rows, ["date", "event name", "membership"]);
  if (headerRow < 0) return null;
  const header = rows[headerRow];
  const columns = layoutOf(header, "main");
  const readonly = layoutOf(header, "readonly");
  const nameCol = findColumn(header, "event name");
  const walks: SheetWalk[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const title = (row[nameCol] ?? "").trim();
    const date = parseSheetDate(row[columns.date] ?? "");
    if (!title || !date) continue;
    const planningRow = planningRowOf(formulas[i]?.[nameCol] ?? "");
    const values: Values = {};
    for (const [key, col] of Object.entries(columns)) {
      // A formula's value isn't the app's to edit (a hike's name comes from its planning row).
      // Nor is a cell an ARRAYFORMULA spills into: no formula of its own, but a value.
      const formula = formulas[i]?.[col] ?? "";
      if (/^=/.test(formula) || (formulas.length > 0 && !formula && row[col])) continue;
      values[key] = row[col] ?? "";
    }
    const shown: Values = {};
    for (const [key, col] of Object.entries(readonly)) shown[key] = row[col] ?? "";
    const distance = parseNumber(shown.distanceShown ?? "");
    walks.push({
      row: i + 1,
      key: keys[i] ?? null,
      date,
      title,
      kind: eventKind(title, distance !== null),
      planningRow,
      values,
      shown,
    });
  }
  return { layout: { headerRow, columns }, readonly, walks };
}

// ---------------------------------------------------------------------------
// Walk leaders

/** One name as written in a leader cell: "Valentino (+)", "Wren🐦(+)", "Diana (+) [1a]", "Niha (+, TBC)". */
export interface LeaderMention {
  name: string;
  firstAid: boolean;
  tentative: boolean;
}

export function parseLeaderCell(text: string): LeaderMention[] {
  if (!text || /^-+$/.test(text.trim()) || text.startsWith("#")) return [];
  return text
    .split(/,(?![^()]*\))|\n|\s+&\s+|\s+and\s+/i)
    .map((part) => {
      const firstAid = /\(\s*\+/.test(part) || /\+\s*\)/.test(part);
      const tentative = /\btbc\b|\?/i.test(part);
      const name = part
        .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
        .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}+?]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { name, firstAid, tentative };
    })
    .filter((m) => m.name.length > 1 && m.name.length < 60 && !/^(tbc|n\/a|none|-+)$/i.test(m.name));
}

/** A name as a lookup key: "E'Jane " → "ejane", "Vítek" → "vitek". */
export function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const LEADER_FIELDS = ["leader1", "leader2", "leader3", "leader4", "leader5", "leader6", "extraLeaders"] as const;

/** Who led a walk, from its sign-up columns, else what the calendar shows. */
export function walkLeaders(values: Values, shown: Values): { leaders: LeaderMention[]; shadows: LeaderMention[] } {
  const fromSignups = LEADER_FIELDS.some((k) => values[k]?.trim());
  const cells = fromSignups
    ? LEADER_FIELDS.map((k) => values[k] ?? "")
    : [shown.firstAider, shown.mainLeader2, shown.mainLeader3, shown.mainLeader4, shown.mainLeader5, shown.mainLeader6, shown.mainExtraLeaders];
  const seen = new Set<string>();
  const leaders: LeaderMention[] = [];
  for (const cell of cells) {
    for (const m of parseLeaderCell(cell ?? "")) {
      if (m.tentative || seen.has(nameKey(m.name))) continue;
      seen.add(nameKey(m.name));
      leaders.push(m);
    }
  }
  const shadows = parseLeaderCell((fromSignups ? values.shadowing : shown.mainShadowing) ?? "").filter(
    (m) => !m.tentative && !seen.has(nameKey(m.name)),
  );
  return { leaders, shadows };
}

// ---------------------------------------------------------------------------
// Roster

export const ROSTER_HEADER = ["Name (as on the calendar)", "Email", "Also written as", "First aid trained", "First aid valid until", "Active", "Notes"];

export interface RosterEntry {
  /** 1-based sheet row. */
  row: number;
  name: string;
  email: string | null;
  aliases: string[];
  firstAid: boolean;
  firstAidUntil: string | null;
  active: boolean;
}

const truthy = (t: string | undefined) => /^(true|yes|y|✓|✅|x)$/i.test((t ?? "").trim());

export function readRoster(rows: string[][]): RosterEntry[] {
  const out: RosterEntry[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const name = (r[0] ?? "").trim();
    if (!name) continue;
    const email = (r[1] ?? "").trim().toLowerCase();
    out.push({
      row: i + 1,
      name,
      email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
      aliases: (r[2] ?? "").split(",").map((a) => a.trim()).filter(Boolean),
      firstAid: truthy(r[3]),
      firstAidUntil: parseSheetDate(r[4] ?? ""),
      active: (r[5] ?? "").trim() === "" ? true : truthy(r[5]),
    });
  }
  return out;
}

/** Name key → roster entry, through the main name and every alias. */
export function rosterIndex(roster: RosterEntry[]): Map<string, RosterEntry> {
  const index = new Map<string, RosterEntry>();
  for (const entry of roster) {
    for (const n of [entry.name, ...entry.aliases]) {
      const k = nameKey(n);
      if (k && !index.has(k)) index.set(k, entry);
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Matching calendar rows to SU events

const STOP = new Set(["hike", "walk", "taster", "of", "the", "and", "to", "km", "social", "trip", "club", "day", "circular", "a", "in", "at", "with"]);

export function titleTokens(title: string): Set<string> {
  return new Set(
    nameKey(title)
      .split(" ")
      .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+(km)?$/.test(t)),
  );
}

/** How alike two titles are: shared words over the smaller set. */
export function titleSimilarity(a: string, b: string): number {
  const x = titleTokens(a);
  const y = titleTokens(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared += 1;
  return shared / Math.min(x.size, y.size);
}

export interface SuCandidate {
  suuId: string;
  title: string;
  /** London date, YYYY-MM-DD. */
  date: string;
}

/** The SU event on the same day whose title clearly matches, if one does. */
export function matchSuEvent(walk: { date: string; title: string }, events: SuCandidate[]): SuCandidate | null {
  const sameDay = events
    .filter((e) => e.date === walk.date)
    .map((e) => ({ e, score: titleSimilarity(walk.title, e.title) }))
    .sort((a, b) => b.score - a.score);
  const [best, next] = sameDay;
  if (!best) return null;
  // The only event that day, and not obviously something else.
  if (sameDay.length === 1 && best.score >= 0.34) return best.e;
  if (best.score >= 0.5 && (!next || best.score - next.score >= 0.25)) return best.e;
  return null;
}

/** "Walk" and "hike" rows are the ones with leaders, distance and a leaderboard. */
export function isWalkKind(kind: EventKind): boolean {
  return kind === "hike" || kind === "walk";
}
