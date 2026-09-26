import { describe, expect, it } from "vitest";
import { parseIncident } from "./incidents";

describe("parseIncident", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  it("accepts a report and defaults the time to now", () => {
    expect(parseIncident({ kind: "injury", description: " Twisted ankle " }, now)).toEqual({
      ok: true,
      incident: { event_suu_id: null, occurred_at: now.toISOString(), kind: "injury", description: "Twisted ankle", actions_taken: null, follow_up: null },
    });
  });
  it("needs a kind, a description, and a time that isn't in the future", () => {
    expect(parseIncident({ kind: "meteor", description: "x" }, now).ok).toBe(false);
    expect(parseIncident({ kind: "injury", description: "  " }, now).ok).toBe(false);
    expect(parseIncident({ kind: "injury", description: "x", occurred_at: "2026-10-19T12:00:00Z" }, now).ok).toBe(false);
  });
});
