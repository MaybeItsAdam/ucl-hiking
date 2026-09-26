import { describe, expect, it } from "vitest";
import { applyOps, expiryFor, outboxKey, purgeExpired, read, snapshotKey, write } from "./dayOffline";
import type { Attendee } from "./attendees";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

const person = (id: string, over: Partial<Attendee> = {}): Attendee => ({
  id,
  event_suu_id: "ev",
  member_id: null,
  name: id,
  email: null,
  source: "toolbox",
  removed: false,
  checked_in_at: null,
  returned_at: null,
  ...over,
});

describe("offline register", () => {
  it("expires a day after the walk ends", () => {
    expect(expiryFor({ starts_at: "2026-10-18T08:00:00Z", ends_at: "2026-10-18T18:00:00Z" })).toBe(Date.parse("2026-10-19T18:00:00Z"));
  });

  it("reads back what it wrote until it expires, then deletes it", () => {
    const storage = new MemoryStorage();
    write(storage, snapshotKey("e1"), { hello: 1 }, 1000);
    expect(read(storage, snapshotKey("e1"), 999)).toEqual({ hello: 1 });
    expect(read(storage, snapshotKey("e1"), 1001)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("purges every expired walk but leaves other keys alone", () => {
    const storage = new MemoryStorage();
    write(storage, snapshotKey("old"), 1, 10);
    write(storage, outboxKey("old"), [], 10);
    write(storage, snapshotKey("new"), 2, 1000);
    storage.setItem("ucl_hiking_theme", "dark");
    purgeExpired(storage, 500);
    expect(storage.getItem(snapshotKey("old"))).toBeNull();
    expect(storage.getItem(outboxKey("old"))).toBeNull();
    expect(read(storage, snapshotKey("new"), 500)).toBe(2);
    expect(storage.getItem("ucl_hiking_theme")).toBe("dark");
  });

  it("shows queued taps on top of the stored register", () => {
    const list = [person("a"), person("b"), person("c", { removed: true })];
    const shown = applyOps(list, [
      { kind: "check_in", attendeeId: "a", at: "t1" },
      { kind: "check_in", attendeeId: "b", at: "t2" },
      { kind: "undo_check_in", attendeeId: "b", at: "t3" },
      { kind: "all_back", at: "t4" },
    ]);
    expect(shown.map((p) => [p.id, p.checked_in_at, p.returned_at])).toEqual([
      ["a", "t1", "t4"],
      ["b", null, null],
      ["c", null, null],
    ]);
    expect(list[0].checked_in_at).toBeNull();
  });
});
