import { describe, expect, it } from "vitest";
import { historyAsOf, leaderCells, leaderChanges, sameLeaders } from "@/lib/leaderHistory";

describe("leader history", () => {
  it("reads every rota field, trimmed", () => {
    const cells = leaderCells({ leader1: " Kelvin (+) ", shadowing: "A, B" });
    expect(cells.leader1).toBe("Kelvin (+)");
    expect(cells.leader6).toBe("");
    expect(cells.shadowing).toBe("A, B");
  });

  it("lists only the cells that differ", () => {
    const now = leaderCells({ leader1: "Tiffany (+)", leader5: "L" });
    const then = leaderCells({ leader5: "Natalia", leader6: "Anne" });
    expect(sameLeaders(now, then)).toBe(false);
    expect(leaderChanges(now, then)).toEqual([
      { field: "leader1", now: "Tiffany (+)", then: "" },
      { field: "leader5", now: "L", then: "Natalia" },
      { field: "leader6", now: "", then: "Anne" },
    ]);
  });

  it("takes the newest record at or before the moment", () => {
    const row = (seen_at: string, who: string) => ({ row_key: "k", seen_at, cells: leaderCells({ leader2: who }) });
    const got = historyAsOf([row("2026-10-13T15:00:00Z", "A"), row("2026-10-25T18:59:00Z", "B"), row("2026-10-26T15:00:00Z", "C")], "2026-10-26T14:30:00Z");
    expect(got.get("k")?.cells.leader2).toBe("B");
  });
});
