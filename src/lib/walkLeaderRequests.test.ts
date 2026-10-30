import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/walkSheetSync", () => ({ setRosterLeader: vi.fn() }));

const { findUnlinked } = await import("./walkLeaderRequests");

describe("findUnlinked", () => {
  const names = ["Kelvin", "Samuel B", "Zoë"];

  it("returns the roster's own spelling", () => {
    expect(findUnlinked(names, "  kelvin ")).toBe("Kelvin");
    expect(findUnlinked(names, "Zoe")).toBe("Zoë");
  });

  it("refuses a name that isn't unclaimed", () => {
    expect(findUnlinked(names, "Samuel")).toBeNull();
    expect(findUnlinked([], "Kelvin")).toBeNull();
  });
});
