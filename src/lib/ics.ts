import { createHmac, timingSafeEqual } from "node:crypto";
import { londonDay } from "@/lib/weather";
import type { SUEvent } from "@/lib/types";

/**
 * iCalendar (RFC 5545) for the club's events: one file per event to add to a
 * calendar, and a feed URL a member subscribes to once.
 */

export interface IcsEvent {
  uid: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  url: string | null;
  cancelled: boolean;
}

/** Commas, semicolons, backslashes and newlines are escaped in TEXT values. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets continue on the next line after a space. */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-byte character: back up to a lead byte.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // the leading space counts
  }
  return parts.join("\r\n ");
}

function utc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function date(iso: string): string {
  return londonDay(iso).replace(/-/g, "");
}

function nextDay(yyyymmdd: string): string {
  const d = new Date(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function vevent(event: IcsEvent, stamp: string): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${event.uid}`, `DTSTAMP:${stamp}`];
  if (event.allDay) {
    const start = date(event.startsAt);
    // DTEND is exclusive for all-day events.
    const end = event.endsAt ? nextDay(date(event.endsAt)) : nextDay(start);
    lines.push(`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`);
  } else {
    lines.push(`DTSTART:${utc(event.startsAt)}`);
    const end = event.endsAt && new Date(event.endsAt) > new Date(event.startsAt) ? event.endsAt : null;
    lines.push(end ? `DTEND:${utc(end)}` : "DURATION:PT8H");
  }
  lines.push(`SUMMARY:${escapeText(event.cancelled ? `Cancelled: ${event.title}` : event.title)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  if (event.cancelled) lines.push("STATUS:CANCELLED");
  lines.push("END:VEVENT");
  return lines;
}

export function buildCalendar(events: IcsEvent[], name = "UCL Hiking Club", now = new Date()): string {
  const stamp = utc(now.toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//UCL Hiking Club//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    "X-WR-TIMEZONE:Europe/London",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    ...events.flatMap((event) => vevent(event, stamp)),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.HIKING_WEB_URL || "https://ucl-hiking.vercel.app").replace(/\/$/, "");
}

/** An event as a calendar entry. The UID is the SU id, so re-imports update rather than duplicate. */
export function toIcsEvent(
  event: SUEvent,
  extra: { meetPoint?: string | null; meetAt?: string | null } = {},
): IcsEvent | null {
  if (!event.starts_at) return null;
  const page = `${appOrigin()}/portal/events/${event.id}`;
  const meet = [extra.meetAt ? `Meet ${new Date(extra.meetAt).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })}` : null, extra.meetPoint]
    .filter(Boolean)
    .join(" at ");
  return {
    uid: `${event.suu_event_id ?? event.id}@uclhiking`,
    title: event.title,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    allDay: Boolean(event.is_all_day),
    location: extra.meetPoint || event.location,
    description: [meet || null, page].filter(Boolean).join("\n"),
    url: page,
    cancelled: event.status === "cancelled",
  };
}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return value;
}

function signature(memberId: string, version: number): string {
  return createHmac("sha256", secret()).update(`calendar:${memberId}:${version}`).digest("base64url").slice(0, 32);
}

/** The private part of a member's feed URL. Bumping `version` revokes the old one. */
export function calendarToken(memberId: string, version: number): string {
  return `${memberId}.${signature(memberId, version)}`;
}

/** The member a token names, if its signature matches their current version. */
export function readCalendarToken(token: string): { memberId: string; signature: string } | null {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{32})$/i.exec(token);
  return match ? { memberId: match[1], signature: match[2] } : null;
}

export function calendarSignatureMatches(memberId: string, version: number, given: string): boolean {
  const expected = Buffer.from(signature(memberId, version));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
