import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { canViewSafety, cleanPhone, decryptSafety, encryptSafety, parseSafetyInput } from "./safety";

beforeAll(() => {
  process.env.SAFETY_DATA_KEY = randomBytes(32).toString("base64");
});

const details = {
  phone: "07700 900123",
  contact_name: "Grace",
  contact_relation: "Mum",
  contact_phone: "+44 7700 900456",
  medical_notes: "Asthma; inhaler in lid pocket",
};

describe("safety encryption", () => {
  it("round-trips and never stores plaintext", () => {
    const payload = encryptSafety(details);
    expect(payload).not.toContain("Asthma");
    expect(payload.startsWith("v1.")).toBe(true);
    expect(decryptSafety(payload)).toEqual(details);
  });

  it("uses a fresh IV each time and refuses tampered payloads", () => {
    expect(encryptSafety(details)).not.toBe(encryptSafety(details));
    const parts = encryptSafety(details).split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSafety(parts.join("."))).toThrow();
  });
});

describe("canViewSafety", () => {
  const base = {
    viewerId: "L",
    leaderId: "L",
    backmarkerId: "B",
    startsAt: "2026-10-18T08:00:00Z",
    endsAt: "2026-10-18T18:00:00Z",
    attendee: { member_id: "m1", removed: false },
  };

  it("lets the leader and backmarker see details within a day of the walk", () => {
    expect(canViewSafety({ ...base, now: new Date("2026-10-17T09:00:00Z") })).toBe(true);
    expect(canViewSafety({ ...base, viewerId: "B", now: new Date("2026-10-19T17:00:00Z") })).toBe(true);
  });

  it("refuses outside the window", () => {
    expect(canViewSafety({ ...base, now: new Date("2026-10-17T07:00:00Z") })).toBe(false);
    expect(canViewSafety({ ...base, now: new Date("2026-10-19T19:00:00Z") })).toBe(false);
  });

  it("refuses committee who aren't on the walk, removed attendees and walk-ups with no member", () => {
    const now = new Date("2026-10-18T09:00:00Z");
    expect(canViewSafety({ ...base, viewerId: "C", now })).toBe(false);
    expect(canViewSafety({ ...base, attendee: { member_id: "m1", removed: true }, now })).toBe(false);
    expect(canViewSafety({ ...base, attendee: { member_id: null, removed: false }, now })).toBe(false);
    expect(canViewSafety({ ...base, leaderId: null, backmarkerId: null, now })).toBe(false);
  });
});

describe("parseSafetyInput", () => {
  it("accepts UK and international numbers, refuses nonsense", () => {
    expect(cleanPhone("07700  900123")).toBe("07700 900123");
    expect(cleanPhone("+44 (0)20 7679 2000")).toBe("+44 (0)20 7679 2000");
    expect(cleanPhone("call me")).toBe("invalid");
    expect(cleanPhone("")).toBeNull();
  });

  it("needs a number for a named contact", () => {
    expect(parseSafetyInput({ contact_name: "Grace" })).toEqual({ ok: false, error: "Add a phone number for your emergency contact." });
    expect(parseSafetyInput(details)).toEqual({ ok: true, details });
  });
});
