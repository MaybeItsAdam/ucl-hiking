/**
 * GPX in, a small route out. A walk's route arrives as a .gpx file a leader
 * exported from OS Maps, Komoot or a watch; this reads its tracks, routes and
 * waypoints, measures it, and thins it to a size that sits comfortably in a
 * database row and a page payload.
 *
 * A hand parser rather than an XML library: GPX is a flat, well-known shape,
 * and scanning tags with linear regexes never expands entities or DOCTYPEs,
 * so a hostile file can't blow up the server.
 */

/** [lat, lng] or [lat, lng, elevation in metres]. */
export type TrackPoint = [number, number] | [number, number, number];

export interface Waypoint {
  lat: number;
  lng: number;
  name: string | null;
}

export interface ParsedGpx {
  name: string | null;
  /** Each unbroken line: a track segment or a planned route. */
  segments: TrackPoint[][];
  waypoints: Waypoint[];
}

export interface RouteSummary {
  distanceM: number;
  /** Null when the file carries no elevations. */
  ascentM: number | null;
  descentM: number | null;
}

/** The largest file we read, uploaded or fetched: under Vercel's 4.5 MB request body cap. */
export const GPX_MAX_BYTES = 4 * 1024 * 1024;
/** Points kept for storage and download: plenty for a watch to follow. */
export const STORE_TOLERANCE_M = 4;
export const STORE_MAX_POINTS = 5000;
/** Points drawn on the event page's map. */
export const DISPLAY_TOLERANCE_M = 12;
export const DISPLAY_MAX_POINTS = 1500;
const MAX_WAYPOINTS = 100;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeText(raw: string): string {
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1].trim();
  return raw
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
      if (e[0] !== "#") return ENTITIES[e.toLowerCase()];
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .trim();
}

function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  return m ? (m[1] ?? m[2]) : null;
}

function coord(attrs: string): [number, number] | null {
  const rawLat = attr(attrs, "lat");
  const rawLng = attr(attrs, "lon");
  if (rawLat === null || rawLng === null || !rawLat.trim() || !rawLng.trim()) return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

/** Does this text look like a GPX document at all? */
export function looksLikeGpx(text: string): boolean {
  return /<(?:[\w.-]+:)?gpx[\s>]/i.test(text.slice(0, 4096));
}

/**
 * Read a GPX document. Tracks win over routes when a file has both, since a
 * recorded or exported track follows the paths and a route is only turn points.
 */
export function parseGpx(text: string): ParsedGpx {
  if (!looksLikeGpx(text)) throw new Error("That isn't a GPX file.");

  const tag = /<(\/?)(?:[\w.-]+:)?(gpx|metadata|trk|trkseg|trkpt|rte|rtept|wpt|ele|name)\b([^>]*)>/gi;
  const trackSegs: TrackPoint[][] = [];
  const routes: TrackPoint[][] = [];
  const waypoints: Waypoint[] = [];
  const names: Record<string, string> = {};

  const stack: string[] = [];
  let seg: TrackPoint[] | null = null;
  let rte: TrackPoint[] | null = null;
  let point: { at: [number, number]; ele: number | null; name: string | null; kind: string } | null = null;

  /** The text up to the matching close tag, CDATA and all. */
  const textUntilClose = (from: number, tagName: string): { value: string; end: number } => {
    const close = new RegExp(`</(?:[\\w.-]+:)?${tagName}\\s*>`, "gi");
    close.lastIndex = from;
    const m = close.exec(text);
    if (!m) return { value: "", end: text.length };
    return { value: text.slice(from, m.index), end: m.index + m[0].length };
  };

  let m: RegExpExecArray | null;
  while ((m = tag.exec(text))) {
    const closing = m[1] === "/";
    const nameLc = m[2].toLowerCase();
    const attrs = m[3];
    const selfClosing = attrs.trimEnd().endsWith("/");

    if (!closing && (nameLc === "ele" || nameLc === "name")) {
      if (selfClosing) continue;
      const { value, end } = textUntilClose(tag.lastIndex, nameLc);
      tag.lastIndex = end;
      if (nameLc === "ele") {
        const ele = Number(decodeText(value));
        if (point && Number.isFinite(ele) && value.trim()) point.ele = ele;
      } else {
        const label = decodeText(value).slice(0, 120) || null;
        if (point) point.name = label;
        else if (label && !names[stack.at(-1) ?? ""]) names[stack.at(-1) ?? ""] = label;
      }
      continue;
    }

    if (nameLc === "trkpt" || nameLc === "rtept" || nameLc === "wpt") {
      if (!closing) {
        // A point with bad coordinates is still opened, so its <ele> and <name> land on it and are dropped with it.
        point = { at: coord(attrs) ?? [NaN, NaN], ele: null, name: null, kind: nameLc };
        if (!selfClosing) continue;
      }
      // Closing tag, or a self-closing point: file it.
      if (point && Number.isFinite(point.at[0])) {
        const p: TrackPoint = point.ele === null ? [point.at[0], point.at[1]] : [point.at[0], point.at[1], point.ele];
        if (point.kind === "trkpt") (seg ??= []).push(p);
        else if (point.kind === "rtept") (rte ??= []).push(p);
        else if (waypoints.length < MAX_WAYPOINTS) waypoints.push({ lat: p[0], lng: p[1], name: point.name });
      }
      point = null;
      continue;
    }

    if (selfClosing) continue;
    if (!closing) {
      stack.push(nameLc);
      if (nameLc === "trkseg") seg = [];
      if (nameLc === "rte") rte = [];
    } else {
      // Pop back to the matching open tag, tolerating sloppy nesting.
      const at = stack.lastIndexOf(nameLc);
      if (at >= 0) stack.length = at;
      if (nameLc === "trkseg" || (nameLc === "trk" && seg)) {
        if (seg && seg.length) trackSegs.push(seg);
        seg = null;
      }
      if (nameLc === "rte") {
        if (rte && rte.length) routes.push(rte);
        rte = null;
      }
    }
  }
  if (seg && seg.length) trackSegs.push(seg);
  if (rte && rte.length) routes.push(rte);

  const segments = (trackSegs.length ? trackSegs : routes).filter((s) => s.length >= 2);
  if (!segments.length) throw new Error("That GPX file has no track or route in it.");
  return { name: names.metadata ?? names.trk ?? names.rte ?? null, segments, waypoints };
}

const EARTH_M = 6371008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineM(a: TrackPoint, b: TrackPoint): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Climb smaller than this, up then down again, is GPS and DEM noise. */
const ELEVATION_NOISE_M = 5;

/**
 * Length and climb. Climb counts only rises and falls bigger than the noise
 * band, the way watches and OS Maps do; summing every wobble doubles it.
 */
export function summarise(segments: TrackPoint[][]): RouteSummary {
  let distanceM = 0;
  let ascent = 0;
  let descent = 0;
  let sawEle = false;
  for (const seg of segments) {
    let anchor: number | null = null;
    for (let i = 0; i < seg.length; i++) {
      if (i) distanceM += haversineM(seg[i - 1], seg[i]);
      const ele = seg[i][2];
      if (ele === undefined) continue;
      sawEle = true;
      if (anchor === null) anchor = ele;
      else if (ele - anchor >= ELEVATION_NOISE_M) {
        ascent += ele - anchor;
        anchor = ele;
      } else if (anchor - ele >= ELEVATION_NOISE_M) {
        descent += anchor - ele;
        anchor = ele;
      }
    }
  }
  return {
    distanceM: Math.round(distanceM),
    ascentM: sawEle ? Math.round(ascent) : null,
    descentM: sawEle ? Math.round(descent) : null,
  };
}

/**
 * Douglas–Peucker in metres (a flat projection about the line's own latitude,
 * exact enough over a day's walk). Iterative, so a long track can't overflow
 * the stack.
 */
export function simplify(points: TrackPoint[], toleranceM: number): TrackPoint[] {
  if (points.length <= 2) return points.slice();
  const lat0 = rad(points.reduce((s, p) => s + p[0], 0) / points.length);
  const kx = EARTH_M * Math.cos(lat0) * (Math.PI / 180);
  const ky = EARTH_M * (Math.PI / 180);
  const xs = points.map((p) => p[1] * kx);
  const ys = points.map((p) => p[0] * ky);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const tol2 = toleranceM * toleranceM;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const dx = xs[b] - xs[a];
    const dy = ys[b] - ys[a];
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = tol2;
    for (let i = a + 1; i < b; i++) {
      let px = xs[i] - xs[a];
      let py = ys[i] - ys[a];
      if (len2 > 0) {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        px -= t * dx;
        py -= t * dy;
      }
      const d = px * px + py * py;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Thin every segment together until the whole route fits under `maxPoints`. */
export function simplifySegments(segments: TrackPoint[][], toleranceM: number, maxPoints: number): TrackPoint[][] {
  let tol = toleranceM;
  for (let tries = 0; ; tries++) {
    const out = segments.map((s) => simplify(s, tol));
    if (out.reduce((n, s) => n + s.length, 0) <= maxPoints || tries >= 12) return out;
    tol *= 1.6;
  }
}

/** Five decimals is about a metre; one for elevation. Keeps the JSON small. */
export function roundPoints(segments: TrackPoint[][]): TrackPoint[][] {
  const r = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
  return segments.map((s) => s.map((p) => (p.length === 3 ? [r(p[0], 5), r(p[1], 5), r(p[2], 1)] : [r(p[0], 5), r(p[1], 5)])));
}

export interface StoredRoute {
  name: string | null;
  segments: TrackPoint[][];
  waypoints: Waypoint[];
  summary: RouteSummary;
}

/** Parse, measure on the full-resolution track, then thin it for keeping. */
export function prepareRoute(text: string): StoredRoute {
  const parsed = parseGpx(text);
  return {
    name: parsed.name,
    segments: roundPoints(simplifySegments(parsed.segments, STORE_TOLERANCE_M, STORE_MAX_POINTS)),
    waypoints: parsed.waypoints,
    summary: summarise(parsed.segments),
  };
}

const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]!);

/** Write a route back out as GPX 1.1, for "Download GPX". */
export function toGpx(route: Pick<StoredRoute, "name" | "segments" | "waypoints">, fallbackName: string): string {
  const name = escapeXml(route.name || fallbackName);
  const pt = (tagName: string, p: TrackPoint, inner = "") =>
    `<${tagName} lat="${p[0]}" lon="${p[1]}">${p[2] !== undefined ? `<ele>${p[2]}</ele>` : ""}${inner}</${tagName}>`;
  const wpts = route.waypoints
    .map((w) => pt("wpt", [w.lat, w.lng], w.name ? `<name>${escapeXml(w.name)}</name>` : ""))
    .join("\n  ");
  const segs = route.segments.map((s) => `    <trkseg>\n      ${s.map((p) => pt("trkpt", p)).join("\n      ")}\n    </trkseg>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="UCL Hiking Club" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${name}</name></metadata>
  ${wpts}
  <trk>
    <name>${name}</name>
${segs}
  </trk>
</gpx>
`;
}
