import { describe, expect, it } from "vitest";
import { fetchAll, PAGE_SIZE } from "@/lib/paging";

/** A fake table of `n` rows answering `.range(from, to)` like PostgREST. */
function table(n: number, failAt?: number) {
  const rows = Array.from({ length: n }, (_, i) => i);
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    if (failAt === from) return { data: null, error: { message: "boom" } };
    return { data: rows.slice(from, to + 1), error: null };
  };
  return { rows, calls, page };
}

describe("fetchAll", () => {
  it("reads past the 1000-row cap", async () => {
    const t = table(2345);
    const { rows, error } = await fetchAll(t.page);
    expect(error).toBeNull();
    expect(rows).toEqual(t.rows);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("asks once more when the last page is exactly full", async () => {
    const t = table(PAGE_SIZE * 2);
    const { rows } = await fetchAll(t.page);
    expect(rows).toHaveLength(PAGE_SIZE * 2);
    expect(t.calls).toHaveLength(3);
  });

  it("reads one page for a small or empty table", async () => {
    for (const n of [0, 800]) {
      const t = table(n);
      expect((await fetchAll(t.page)).rows).toHaveLength(n);
      expect(t.calls).toEqual([[0, 999]]);
    }
  });

  it("honours a smaller page size", async () => {
    const t = table(7);
    expect((await fetchAll(t.page, 3)).rows).toEqual(t.rows);
    expect(t.calls).toEqual([
      [0, 2],
      [3, 5],
      [6, 8],
    ]);
  });

  it("stops at an error and keeps the rows read so far", async () => {
    const t = table(2500, 1000);
    const { rows, error } = await fetchAll(t.page);
    expect(error).toEqual({ message: "boom" });
    expect(rows).toHaveLength(1000);
  });
});
