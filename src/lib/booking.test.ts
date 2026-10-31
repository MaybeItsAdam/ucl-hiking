import { describe, expect, it } from "vitest";
import { bookingFor, isOver, suUrl } from "@/lib/booking";
import { SU_MEMBERSHIP_URL } from "@/lib/toolbox";
import type { SUEvent } from "@/lib/types";

const NOW = new Date("2026-10-31T12:00:00Z");
const SU_PAGE = "https://studentsunionucl.org/whats-on/clubs-societies/seven-sisters-hike";

function event(overrides: Partial<Pick<SUEvent, "status" | "starts_at" | "ends_at">> = {}) {
  return { status: "upcoming" as SUEvent["status"], starts_at: "2026-11-07T08:00:00Z", ends_at: "2026-11-07T18:00:00Z", ...overrides };
}

describe("suUrl", () => {
  it("keeps https links to the SU's site", () => {
    expect(suUrl(SU_PAGE)).toBe(SU_PAGE);
    expect(suUrl(" https://www.studentsunionucl.org/x ")).toBe("https://www.studentsunionucl.org/x");
  });

  it("refuses anything else", () => {
    expect(suUrl("http://studentsunionucl.org/x")).toBeNull();
    expect(suUrl("https://studentsunionucl.org.evil.com/x")).toBeNull();
    expect(suUrl("https://evilstudentsunionucl.org/x")).toBeNull();
    expect(suUrl("not a url")).toBeNull();
    expect(suUrl("")).toBeNull();
    expect(suUrl(null)).toBeNull();
  });
});

describe("isOver", () => {
  it("is over once the end has passed", () => {
    expect(isOver(event({ ends_at: "2026-10-31T11:00:00Z" }), NOW)).toBe(true);
    expect(isOver(event({ starts_at: "2026-10-31T08:00:00Z", ends_at: "2026-10-31T18:00:00Z" }), NOW)).toBe(false);
  });

  it("without an end, runs to the close of its London day", () => {
    expect(isOver(event({ starts_at: "2026-10-31T07:00:00Z", ends_at: null }), NOW)).toBe(false);
    expect(isOver(event({ starts_at: "2026-10-30T07:00:00Z", ends_at: null }), NOW)).toBe(true);
  });

  it("is over when the SU says it's completed, and never with no dates", () => {
    expect(isOver(event({ status: "completed" }), NOW)).toBe(true);
    expect(isOver(event({ starts_at: null, ends_at: null }), NOW)).toBe(false);
  });
});

describe("bookingFor", () => {
  it("prefers the leader's link", () => {
    expect(bookingFor(event(), { plan: SU_PAGE, sheet: "https://studentsunionucl.org/other" }, NOW)).toEqual({
      href: SU_PAGE,
      label: "Book on the SU",
      specific: true,
      soldOut: false,
    });
  });

  it("doesn't call a leader's non-SU link the SU", () => {
    expect(bookingFor(event(), { plan: "https://forms.example.com/sign-up" }, NOW)).toMatchObject({ label: "Book a place", specific: true });
  });

  it("falls back to the sheet's SU event link, but only an SU one", () => {
    expect(bookingFor(event(), { plan: null, sheet: SU_PAGE }, NOW)).toMatchObject({ href: SU_PAGE, label: "Book on the SU", specific: true });
    expect(bookingFor(event(), { sheet: "https://example.com/x" }, NOW)).toMatchObject({ href: SU_MEMBERSHIP_URL, specific: false });
  });

  it("falls back to the club's SU page, labelled as such", () => {
    expect(bookingFor(event(), {}, NOW)).toEqual({ href: SU_MEMBERSHIP_URL, label: "Tickets on the SU", specific: false, soldOut: false });
  });

  it("marks a sold-out event", () => {
    expect(bookingFor(event({ status: "sold_out" }), { plan: SU_PAGE }, NOW)?.soldOut).toBe(true);
  });

  it("offers nothing for a cancelled, finished or draft event", () => {
    expect(bookingFor(event({ status: "cancelled" }), { plan: SU_PAGE }, NOW)).toBeNull();
    expect(bookingFor(event({ status: "draft" }), { plan: SU_PAGE }, NOW)).toBeNull();
    expect(bookingFor(event({ starts_at: "2026-10-24T08:00:00Z", ends_at: "2026-10-24T18:00:00Z" }), { plan: SU_PAGE }, NOW)).toBeNull();
  });
});
