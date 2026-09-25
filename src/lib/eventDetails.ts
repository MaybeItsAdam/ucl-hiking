import type { SUEvent } from "@/lib/types";

/**
 * What an event *is*, read out of the text the committee already writes.
 *
 * Toolbox sends a title and a description and nothing structured, but the
 * committee's walk posts follow one template closely: a title such as
 * "🌳 Taster Hike (8 of 8): Seven Sisters #2 (22km)", then "📐 DISTANCE:",
 * "🏔️ TOTAL ASCENT:", "⚖️ DIFFICULTY:" and a day schedule that names the
 * station the group takes the train to and the one it finishes at. Reading
 * those gives the Events tab its stats and the map its places, with no new
 * form for anyone to fill in. Everything is optional: a social has none of it.
 */

export type EventKind = "hike" | "walk" | "social" | "trip" | "club" | "other";

/** The club's own grading scale, green to double black. */
export type Difficulty = "beginner" | "moderate" | "challenging" | "difficult" | "extreme";

export const KIND_LABELS: Record<EventKind, string> = {
  hike: "Hike",
  walk: "Walk",
  social: "Social",
  trip: "Trip",
  club: "Club",
  other: "Event",
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: "Beginner",
  moderate: "Moderate",
  challenging: "Challenging",
  difficult: "Difficult",
  extreme: "Extreme",
};

export interface EventDetails {
  kind: EventKind;
  /** The leading emoji of the title, if it has one. */
  emoji: string | null;
  /** "Taster Hike (8 of 8)" — the part of the title before its colon. */
  eyebrow: string | null;
  /** "Seven Sisters #2" — the title without its emoji, eyebrow or distance. */
  name: string;
  distanceKm: number | null;
  ascentM: number | null;
  difficulty: Difficulty | null;
  /** "£31.65", as written. */
  trainFare: string | null;
  /** Where the group gathers in London, e.g. "London Bridge Station". */
  meetingPoint: string | null;
  /** The town the train goes to, where walking starts. */
  start: string | null;
  /** Where walking ends; the same as `start` on a circular. */
  finish: string | null;
  /** The opening paragraph, before the template's fact sheet. */
  lead: string | null;
  /** The whole description, reflowed into paragraphs. */
  body: string[];
  /** Everything after `lead`. */
  more: string[];
}

const PICTOGRAPH = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/u;
const LEADING_EMOJI = /^(?:[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}][️‍\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}]*\s*)+/u;
const TRAILING_EMOJI = /(?:\s*[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}][️‍\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}]*)+\s*$/u;
const DISTANCE_SUFFIX = /\s*\((\d+(?:\.\d+)?)\s?km\)\s*$/i;

/** Words after which a hard line break in scraped text is mid-sentence. */
const JOINING_WORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "into", "near", "of", "on", "or", "our", "the", "to",
  "via", "with", "your", "around", "approx", "approx.",
]);

function startsWithEmoji(line: string): boolean {
  return PICTOGRAPH.test(line.slice(0, 2));
}

/** "📐 DISTANCE:", "🚂 Travel & Train Tickets": short, starts with an emoji, no full stop. */
export function isHeading(line: string): boolean {
  return startsWithEmoji(line) && line.length <= 48 && !/[.!?]$/.test(line);
}

/**
 * Toolbox descriptions come from HTML with a hard break at every inline tag, so
 * "Morning departure from\nLondon Bridge\nStation" is one sentence over three
 * lines. Join the lines back into sentences, keeping the breaks that are real:
 * after a heading, a full stop or an emoji, and before a new capitalised line
 * that does not continue a proper noun.
 */
export function reflow(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    const prev = out.at(-1);
    if (prev === undefined) {
      out.push(line);
      continue;
    }
    if (/^[.,:;!?]/.test(line)) {
      out[out.length - 1] = prev + line;
      continue;
    }
    if (/^[)\-–]/.test(line)) {
      out[out.length - 1] = `${prev} ${line}`;
      continue;
    }
    const prevEnds = isHeading(prev) || /[.!?]["'’”)]?$/.test(prev) || TRAILING_EMOJI.test(prev);
    if (prevEnds || startsWithEmoji(line)) {
      out.push(line);
      continue;
    }
    const lastWord = prev.split(/\s+/).at(-1) ?? "";
    const continues =
      /^[\p{Ll}\d£(]/u.test(line) ||
      JOINING_WORDS.has(lastWord.toLowerCase()) ||
      // "London Bridge" + "Station": a proper noun running on.
      (/^\p{Lu}/u.test(lastWord) && /^\p{Lu}\p{Ll}*$/u.test(line.split(/\s+/)[0] ?? ""));
    if (continues) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out;
}

/** Split a title at its first colon outside brackets: "Walk (Charity Hike: X): Lewes to Brighton". */
function splitTitle(title: string): { eyebrow: string | null; rest: string } {
  let depth = 0;
  for (let i = 0; i < title.length; i += 1) {
    const ch = title[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0) {
      const eyebrow = title.slice(0, i).trim();
      const rest = title.slice(i + 1).replace(/^[\s:]+/, "").replace(LEADING_EMOJI, "").replace(/^[\s:]+/, "").trim();
      // A long run before the colon is a sentence, not a label.
      if (eyebrow && rest && eyebrow.length <= 48) return { eyebrow, rest };
      break;
    }
  }
  return { eyebrow: null, rest: title };
}

export function eventKind(title: string, hasDistance = false): EventKind {
  const t = title.toLowerCase();
  if (/induction|first aid|training|workshop|hustings|drop-in|welfare|bake sale|agm\b/.test(t)) return "club";
  if (/residential|\btrip\b/.test(t)) return "trip";
  if (/social|party|\bpub\b|crawl|games|quiz|paint|movie|night\b/.test(t)) return "social";
  const hike = t.search(/\bhike\b/);
  const walk = t.search(/\bwalk\b/);
  if (hike >= 0 && (walk < 0 || hike < walk)) return "hike";
  if (walk >= 0) return "walk";
  return hasDistance ? "hike" : "other";
}

function difficultyFrom(text: string): Difficulty | null {
  const match = /DIFFICULTY:[^A-Za-z]*(Beginner|Moderate|Challenging|Difficult|Extreme)/i.exec(text);
  return match ? (match[1].toLowerCase() as Difficulty) : null;
}

function number(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** "Seaford" from "travelling together to Seaford. Take the time…" */
function clean(place: string | undefined): string | null {
  const value = place?.replace(/\s+/g, " ").replace(/^the\s+/i, "").trim();
  return value && value.length <= 40 ? value : null;
}

export function eventDetails(event: Pick<SUEvent, "title" | "description" | "location">): EventDetails {
  const emoji = LEADING_EMOJI.exec(event.title)?.[0].trim() || null;
  const bare = event.title.replace(LEADING_EMOJI, "").trim();
  const { eyebrow, rest } = splitTitle(bare);
  const titleKm = DISTANCE_SUFFIX.exec(rest);
  const name = rest.replace(LEADING_EMOJI, "").replace(DISTANCE_SUFFIX, "").replace(TRAILING_EMOJI, "").trim() || bare;

  const body = reflow(event.description ?? "");
  const flat = body.join(" ");

  const distanceKm = number(/DISTANCE:\s*([\d.]+)\s*km/i.exec(flat)?.[1]) ?? number(titleKm?.[1]);
  const ascentM = number(/ASCENT:\s*([\d,]+)\s*m\b/i.exec(flat)?.[1]);
  const trainFare = /TRAIN TICKET COST:\s*(?:approx\.?\s*)?(£\s?\d+(?:\.\d{2})?)/i.exec(flat)?.[1].replace(/\s/g, "") ?? null;

  let start = clean(/travelling together to\s+([^.,;(!]+)/i.exec(flat)?.[1]);
  let finish = clean(/Finish(?:ing)? the (?:hike|walk) (?:near|at|in)\s+(.+?)\s+station\b/i.exec(flat)?.[1]);
  // No day schedule: "Wye to Canterbury" in the title still says where it goes.
  if (!start) {
    const route = /(?:^|[(:]\s*)([A-Z][\w'’&.\- ]+?) to ([A-Z][\w'’&.\- ]+?)\)?$/.exec(name);
    if (route) {
      start = clean(route[1]);
      finish = finish ?? clean(route[2]);
    }
  }
  if (start && !finish && /circular|loop/i.test(name)) finish = start;

  const departure = /departure from\s+(.+?)\s+Station\b/i.exec(flat)?.[1];
  const location = event.location && !/great outdoors/i.test(event.location) ? event.location : null;
  const meetingPoint = departure ? `${clean(departure)} Station` : location;

  // The template's fact sheet opens with the first emoji heading; before it is the pitch.
  const firstHeading = body.findIndex(isHeading);
  const leadEnd = firstHeading === -1 ? Math.min(1, body.length) : firstHeading;
  const leadLines = body.slice(0, leadEnd);
  const lead = leadLines.join(" ").trim() || null;

  return {
    kind: eventKind(bare, distanceKm !== null),
    emoji,
    eyebrow,
    name,
    distanceKm,
    ascentM,
    difficulty: difficultyFrom(flat),
    trainFare,
    meetingPoint,
    start,
    finish,
    lead,
    body,
    more: body.slice(leadEnd),
  };
}

/** "22 km", "14.3 km": one decimal only when it says something. */
export function formatKm(km: number): string {
  return `${km >= 10 ? Math.round(km) : Math.round(km * 10) / 10} km`;
}

export function formatAscent(m: number): string {
  return `${m.toLocaleString("en-GB")} m`;
}
