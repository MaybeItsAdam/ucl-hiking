import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: vi.fn(), isSupabaseConfigured: () => false }));
vi.mock("@/lib/googleSheets", () => ({
  a1: vi.fn(),
  addTab: vi.fn(),
  appendRows: vi.fn(),
  columnLetter: vi.fn(),
  readValues: vi.fn(),
  rowKeys: vi.fn(),
  SheetsError: class extends Error {},
  spreadsheetTabs: vi.fn(),
  tagRows: vi.fn(),
  writeCells: vi.fn(),
}));

import { mergeWalks, type StoredWalk } from "@/lib/walkSheetSync";
import type { SheetWalk } from "@/lib/walkSheet";

const NOW = "2026-10-02T12:00:00.000Z";

const sheetWalk = (over: Partial<SheetWalk> = {}): SheetWalk & { signupRow: number | null } => ({
  row: 172,
  key: "k1",
  date: "2026-10-03",
  title: "🌻 Taster Walk (3 of 8): Sevenoaks Circular",
  kind: "walk",
  planningRow: 103,
  values: { membership: "Taster", notes: "" },
  shown: { status: "PUBLISHED ✅" },
  signupRow: 95,
  ...over,
});

const stored = (over: Partial<StoredWalk> = {}): StoredWalk => ({
  id: "w1",
  row_key: "k1",
  sheet_row: 172,
  planning_row: 103,
  signup_row: 95,
  starts_on: "2026-10-03",
  title: "🌻 Taster Walk (3 of 8): Sevenoaks Circular",
  kind: "walk",
  sheet_values: { membership: "Taster", notes: "" },
  base: { membership: "Taster", notes: "" },
  shown: { status: "PUBLISHED ✅" },
  conflicts: {},
  event_suu_id: null,
  link_source: null,
  published: true,
  published_source: "sheet",
  visibility: "taster",
  visibility_source: "sheet",
  present: true,
  synced_at: "2026-10-01T00:00:00.000Z",
  ...over,
});

const su = [{ suuId: "su-seven", title: "Taster Walk (3 of 8): Sevenoaks Circular (15km)", date: "2026-10-03" }];

describe("mergeWalks", () => {
  it("adds a new row, published from STATUS and visible as its MEMBERSHIP says", () => {
    const { upserts, changed } = mergeWalks(
      { walks: [sheetWalk({ values: { membership: "Explorer" }, shown: { status: "TBC" } })] },
      [],
      [],
      NOW,
    );
    expect(changed).toBe(1);
    expect(upserts[0]).toMatchObject({ row_key: "k1", published: false, visibility: "explorer", base: { membership: "Explorer" } });
    expect(mergeWalks({ walks: [sheetWalk()] }, [], [], NOW).upserts[0]).toMatchObject({ published: true, visibility: "taster" });
  });

  it("takes a change made only in the sheet as the new agreed value", () => {
    const { upserts, changed } = mergeWalks({ walks: [sheetWalk({ values: { membership: "Discoverer", notes: "Bring lunch" } })] }, [stored()], [], NOW);
    expect(changed).toBe(1);
    expect(upserts[0]).toMatchObject({
      sheet_values: { membership: "Discoverer", notes: "Bring lunch" },
      base: { membership: "Discoverer", notes: "Bring lunch" },
      visibility: "member",
    });
  });

  it("keeps the committee's own publish and visibility over the sheet's", () => {
    const prev = stored({ published: false, published_source: "app", visibility: "public", visibility_source: "app" });
    const { upserts } = mergeWalks({ walks: [sheetWalk({ values: { membership: "Explorer", notes: "" } })] }, [prev], [], NOW);
    expect(upserts[0]).toMatchObject({ published: false, visibility: "public" });
  });

  it("counts nothing as changed when the sheet hasn't moved", () => {
    expect(mergeWalks({ walks: [sheetWalk()] }, [stored()], [], NOW).changed).toBe(0);
  });

  it("marks a row that's left the sheet as gone", () => {
    const { gone, changed } = mergeWalks({ walks: [] }, [stored(), stored({ id: "w2", row_key: "k2", present: false })], [], NOW);
    expect(gone).toEqual(["w1"]);
    expect(changed).toBe(1);
  });

  it("links the SU event automatically, but keeps a link set by hand", () => {
    expect(mergeWalks({ walks: [sheetWalk()] }, [stored()], su, NOW).upserts[0]).toMatchObject({ event_suu_id: "su-seven", link_source: "auto" });
    const manual = stored({ event_suu_id: "su-other", link_source: "manual" });
    expect(mergeWalks({ walks: [sheetWalk()] }, [manual], su, NOW).upserts[0]).toMatchObject({ event_suu_id: "su-other", link_source: "manual" });
  });

  it("drops an automatic link once the event stops matching", () => {
    const prev = stored({ event_suu_id: "su-seven", link_source: "auto" });
    expect(mergeWalks({ walks: [sheetWalk({ date: "2026-10-04" })] }, [prev], su, NOW).upserts[0]).toMatchObject({ event_suu_id: null, link_source: null });
  });

  it("doesn't auto-link an event another row holds by hand", () => {
    const holder = stored({ id: "w2", row_key: "k2", event_suu_id: "su-seven", link_source: "manual" });
    const merged = mergeWalks({ walks: [sheetWalk(), sheetWalk({ key: "k2", row: 300 })] }, [stored(), holder], su, NOW);
    expect(merged.upserts.find((u) => u.row_key === "k1")).toMatchObject({ event_suu_id: null });
    expect(merged.upserts.find((u) => u.row_key === "k2")).toMatchObject({ event_suu_id: "su-seven" });
  });

  it("clears a conflict once the sheet holds the app's value, and tracks the sheet otherwise", () => {
    const conflict = { sheet: "Bring lunch", app: "Bring lunch and water", by: "m1", at: NOW };
    const prev = stored({ conflicts: { notes: conflict }, base: { membership: "Taster", notes: "" } });

    const settled = mergeWalks({ walks: [sheetWalk({ values: { membership: "Taster", notes: "Bring lunch and water" } })] }, [prev], [], NOW);
    expect(settled.upserts[0].conflicts).toEqual({});
    expect(settled.upserts[0].base).toMatchObject({ notes: "Bring lunch and water" });
    expect(settled.conflicts).toBe(0);

    const moved = mergeWalks({ walks: [sheetWalk({ values: { membership: "Taster", notes: "Bring snacks" } })] }, [prev], [], NOW);
    expect(moved.upserts[0].conflicts).toEqual({ notes: { ...conflict, sheet: "Bring snacks" } });
    // The agreed value stays put while it's open.
    expect(moved.upserts[0].base).toMatchObject({ notes: "" });
    expect(moved.conflicts).toBe(1);
  });
});
