import { describe, expect, it } from "vitest";
import { countsForBoard, leaderboard, type BoardWalk } from "@/lib/leaderboard";
import { readRoster } from "@/lib/walkSheet";

const TODAY = "2026-10-02";

const walk = (starts_on: string, km: string, leaders: Record<string, string>, extra: Partial<BoardWalk> = {}): BoardWalk => ({
  starts_on,
  title: "🥾 Hike: Somewhere",
  sheet_values: { distanceKm: km, ...leaders },
  shown: { status: "PUBLISHED ✅" },
  ...extra,
});

const roster = readRoster([
  ["Name (as on the calendar)", "Email", "Also written as"],
  ["Valentino", "val@ucl.ac.uk", "Val"],
]);

describe("countsForBoard", () => {
  it("counts a walk once it has happened, wasn't cancelled and has a distance", () => {
    expect(countsForBoard(walk("2026-09-06", "20.38", {}), TODAY)).toBe(20.38);
    expect(countsForBoard(walk("2026-10-02", "20", {}), TODAY)).toBeNull();
    expect(countsForBoard(walk("2026-10-10", "20", {}), TODAY)).toBeNull();
    expect(countsForBoard(walk("2026-08-01", "20", {}, { shown: { status: "CANCELLED ❌" } }), TODAY)).toBeNull();
    expect(countsForBoard(walk("2026-08-01", "20", {}, { title: "🥾 Hike Canceled: Peak District" }), TODAY)).toBeNull();
    expect(countsForBoard(walk("2026-08-01", "", {}, { shown: { status: "PUBLISHED ✅", distanceShown: "15.9" } }), TODAY)).toBe(15.9);
    expect(countsForBoard(walk("2026-08-01", "", {}), TODAY)).toBeNull();
  });
});

describe("leaderboard", () => {
  const walks = [
    walk("2026-09-06", "20", { leader1: "Valentino (+)", leader2: "Yifei", shadowing: "Rita" }),
    walk("2026-09-12", "10", { leader1: "Val (+)", extraLeaders: "Valentino, Zahra" }),
    walk("2026-09-20", "15", { leader1: "Zahra (+)", leader2: "Yifei", shadowing: "Rita, Gigi" }),
    walk("2026-08-01", "30", { leader1: "Yifei (+)" }, { shown: { status: "CANCELLED ❌" } }),
    walk("2026-10-10", "25", { leader1: "Valentino (+)" }),
  ];
  const board = leaderboard(walks, roster, TODAY);
  const row = (name: string) => board.find((r) => r.name === name);

  it("credits each leader once per walk, joining names through the roster", () => {
    expect(row("Valentino")).toMatchObject({ walks: 2, km: 30, lastWalk: "2026-09-12" });
    expect(board.some((r) => r.name === "Val")).toBe(false);
  });

  it("skips cancelled and future walks", () => {
    expect(row("Yifei")).toMatchObject({ walks: 2, km: 35 });
  });

  it("counts shadowing apart", () => {
    expect(row("Rita")).toMatchObject({ walks: 0, shadowed: 2 });
    expect(row("Gigi")).toMatchObject({ walks: 0, shadowed: 1 });
  });

  it("sorts by walks, then distance, then name", () => {
    expect(board.map((r) => r.name)).toEqual(["Yifei", "Valentino", "Zahra", "Gigi", "Rita"]);
  });
});
