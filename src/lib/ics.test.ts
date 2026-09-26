import { beforeAll, describe, expect, it } from "vitest";
import {
  buildCalendar,
  calendarSignatureMatches,
  calendarToken,
  escapeText,
  foldLine,
  readCalendarToken,
  toIcsEvent,
} from "./ics";
import type { SUEvent } from "./types";

beforeAll(() => {
  process.env.SESSION_SECRET = "12345678901234567890123456789012";
});

const event = (over: Partial<SUEvent> = {}): SUEvent => ({
  id: "33333333-3333-4333-8333-333333333333",
  suu_event_id: "su-123",
  title: "Seven Sisters, 21 km",
  starts_at: "2026-10-18T08:00:00Z",
  ends_at: "2026-10-18T18:00:00Z",
  location: "Seaford",
  status: "upcoming",
  capacity: 40,
  tickets_sold: 12,
  price_pence: 0,
  source_reference: null,
  synced_at: "2026-10-01T00:00:00Z",
  ...over,
});

describe("ics text", () => {
  it("escapes the characters RFC 5545 reserves", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\;c\\\\d\\ne");
  });

  it("folds long lines at 75 octets without splitting a character", () => {
    const line = `SUMMARY:${"é".repeat(60)}`;
    const folded = foldLine(line);
    for (const part of folded.split("\r\n")) expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });
});

describe("buildCalendar", () => {
  it("writes a timed event in UTC, keyed by the SU id", () => {
    const entry = toIcsEvent(event(), { meetPoint: "Victoria", meetAt: "2026-10-18T07:40:00Z" })!;
    const ics = buildCalendar([entry], "Club", new Date("2026-10-01T00:00:00Z"));
    expect(ics).toContain("UID:su-123@uclhiking");
    expect(ics).toContain("DTSTART:20261018T080000Z");
    expect(ics).toContain("DTEND:20261018T180000Z");
    expect(ics).toContain("SUMMARY:Seven Sisters\\, 21 km");
    expect(ics).toContain("LOCATION:Victoria");
    expect(ics).toContain("DESCRIPTION:Meet 08:40 at Victoria");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("writes an all-day weekend with an exclusive end date", () => {
    const entry = toIcsEvent(event({ is_all_day: true, starts_at: "2026-11-06T00:00:00Z", ends_at: "2026-11-08T00:00:00Z" }))!;
    const ics = buildCalendar([entry]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261106");
    expect(ics).toContain("DTEND;VALUE=DATE:20261109");
  });

  it("marks cancelled events", () => {
    const ics = buildCalendar([toIcsEvent(event({ status: "cancelled" }))!]);
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SUMMARY:Cancelled: ");
  });

  it("skips events with no date", () => {
    expect(toIcsEvent(event({ starts_at: null }))).toBeNull();
  });
});

describe("calendar tokens", () => {
  const id = "44444444-4444-4444-8444-444444444444";

  it("round-trips and is bound to the key version", () => {
    const token = calendarToken(id, 0);
    const read = readCalendarToken(token)!;
    expect(read.memberId).toBe(id);
    expect(calendarSignatureMatches(id, 0, read.signature)).toBe(true);
    expect(calendarSignatureMatches(id, 1, read.signature)).toBe(false);
  });

  it("rejects malformed tokens and other members' signatures", () => {
    expect(readCalendarToken("nope")).toBeNull();
    const other = readCalendarToken(calendarToken("55555555-5555-4555-8555-555555555555", 0))!;
    expect(calendarSignatureMatches(id, 0, other.signature)).toBe(false);
  });
});
