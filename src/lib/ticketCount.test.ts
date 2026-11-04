import { describe, expect, it } from "vitest";
import { ticketCount } from "./ticketCount";

const synced = { tickets_sold: 14, capacity: 20, tickets_synced_at: "2026-11-03T20:00:00Z" };

describe("ticketCount", () => {
  it("shows Toolbox's sales counts", () => {
    expect(ticketCount(synced, null)).toEqual({ bought: 14, released: 20, asOf: "2026-11-03T20:00:00Z" });
  });

  it("hides counts no sync has confirmed since the scraper was retired", () => {
    expect(ticketCount({ ...synced, tickets_synced_at: null }, null)).toBeNull();
  });

  it("prefers a newer ticketholder register, keeping the released number", () => {
    expect(ticketCount(synced, { count: 16, syncedAt: "2026-11-04T09:00:00Z" })).toEqual({
      bought: 16,
      released: 20,
      asOf: "2026-11-04T09:00:00Z",
    });
  });

  it("keeps the sales counts when the register is older", () => {
    expect(ticketCount(synced, { count: 9, syncedAt: "2026-11-01T09:00:00Z" })?.bought).toBe(14);
  });

  it("uses the register alone, with released unknown, before any sales sync", () => {
    expect(ticketCount({ tickets_sold: 0, capacity: 0, tickets_synced_at: null }, { count: 5, syncedAt: "2026-11-04T09:00:00Z" })).toEqual({
      bought: 5,
      released: null,
      asOf: "2026-11-04T09:00:00Z",
    });
  });
});
