import { describe, expect, it } from "vitest";
import {
  QUEUE_KEY,
  auditSummary,
  chunk,
  enqueue,
  handoverProgress,
  looksOffline,
  matchItems,
  mergeAfterFlush,
  readQueue,
  requestsWithRoom,
  settleQueue,
  writeQueue,
  type QueuedScan,
} from "./kitScan";

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

const scan = (clientId: string, label = clientId): QueuedScan => ({
  op: { clientId, at: "2026-10-07T10:00:00Z", uid: "04:A1:2B:3C", action: "audit" },
  label,
});

describe("offline scan queue", () => {
  it("round-trips through storage and clears the key when empty", () => {
    const storage = new MemoryStorage();
    writeQueue(storage, [scan("a")]);
    expect(readQueue(storage)).toEqual([scan("a")]);
    writeQueue(storage, []);
    expect(storage.getItem(QUEUE_KEY)).toBeNull();
  });

  it("reads garbage as an empty queue", () => {
    const storage = new MemoryStorage();
    storage.setItem(QUEUE_KEY, "{not json");
    expect(readQueue(storage)).toEqual([]);
    storage.setItem(QUEUE_KEY, JSON.stringify([{ nope: 1 }, scan("b")]));
    expect(readQueue(storage)).toEqual([scan("b")]);
  });

  it("doesn't queue the same scan twice", () => {
    const storage = new MemoryStorage();
    enqueue(storage, scan("a"));
    expect(enqueue(storage, scan("a"))).toHaveLength(1);
    expect(enqueue(storage, scan("b"))).toHaveLength(2);
  });

  it("drops saved and refused scans, keeps retryable and unanswered ones", () => {
    const sent = [scan("ok"), scan("dup"), scan("refused", "TENT-01"), scan("retry"), scan("lost")];
    const { keep, failures, saved } = settleQueue(sent, [
      { clientId: "ok", ok: true },
      { clientId: "dup", ok: true, duplicate: true },
      { clientId: "refused", ok: false, error: "TENT-01 is already out on another loan." },
      { clientId: "retry", ok: false, error: "Couldn't save this scan. It will be retried." },
    ]);
    expect(saved).toBe(2);
    expect(keep.map((k) => k.op.clientId)).toEqual(["retry", "lost"]);
    expect(failures).toEqual([{ clientId: "refused", label: "TENT-01", error: "TENT-01 is already out on another loan." }]);
  });

  it("keeps scans queued while a batch was in flight", () => {
    const sent = [scan("a"), scan("b")];
    const current = [scan("a"), scan("b"), scan("c")];
    expect(mergeAfterFlush(current, sent, [scan("b")]).map((q) => q.op.clientId)).toEqual(["b", "c"]);
  });

  it("chunks into batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe("handover progress", () => {
  it("counts saved and waiting scans toward the request", () => {
    expect(handoverProgress(3, 2)).toMatchObject({ done: 2, total: 3, remaining: 1, complete: false, label: "2 of 3 handed over" });
    expect(handoverProgress(3, 2, 1)).toMatchObject({ done: 3, complete: true, label: "3 of 3 handed over (1 waiting to send)" });
  });

  it("never goes past the request's quantity or below zero", () => {
    expect(handoverProgress(2, 5).done).toBe(2);
    expect(handoverProgress(2, -1).done).toBe(0);
    expect(handoverProgress(0, 0).complete).toBe(false);
  });

  it("offers only approved requests for the same kit with room left", () => {
    const requests = [
      { id: "full", status: "approved", equipment_id: "tent", quantity: 1, items: [{ id: "i1" }] },
      { id: "room", status: "approved", equipment_id: "tent", quantity: 2, items: [{ id: "i2" }] },
      { id: "none-yet", status: "approved", equipment_id: "tent", quantity: 1 },
      { id: "pending", status: "pending", equipment_id: "tent", quantity: 1 },
      { id: "stove", status: "approved", equipment_id: "stove", quantity: 1 },
    ];
    expect(requestsWithRoom(requests, "tent").map((r) => r.id)).toEqual(["room", "none-yet"]);
  });
});

describe("shelf audit", () => {
  const items = [
    { id: "1", tag_uid: "AA", status: "available" as const, asset_code: "TENT-02" },
    { id: "2", tag_uid: "BB", status: "available" as const, asset_code: "TENT-01" },
    { id: "3", tag_uid: "CC", status: "on_loan" as const, asset_code: "TENT-03" },
    { id: "4", tag_uid: "DD", status: "missing" as const, asset_code: "STOVE-01" },
    { id: "5", tag_uid: null, status: "available" as const, asset_code: "TENT-04" },
  ];

  it("lists shelf items not seen, sorted, and counts loans apart", () => {
    const summary = auditSummary(items, ["1"]);
    expect(summary.notSeen.map((i) => i.asset_code)).toEqual(["STOVE-01", "TENT-01"]);
    expect(summary.onLoan).toBe(1);
    expect(summary.expected).toBe(3);
  });

  it("counts a tag seen offline (by uid) as seen", () => {
    expect(auditSummary(items, [], ["AA", "BB", "DD"]).notSeen).toEqual([]);
  });
});

describe("item search", () => {
  const items = [
    { asset_code: "TENT-01", label: "Blue Vango", equipment_name: "Tent" },
    { asset_code: "TENT-10", label: null, equipment_name: "Tent" },
    { asset_code: "STOVE-01", label: null, equipment_name: "Stove" },
  ];

  it("puts an exact asset code first and ignores dashes", () => {
    expect(matchItems(items, "tent01").map((i) => i.asset_code)).toEqual(["TENT-01"]);
    expect(matchItems(items, "TENT-01")[0].asset_code).toBe("TENT-01");
  });

  it("finds by label and kit type, and nothing for a blank query", () => {
    expect(matchItems(items, "vango").map((i) => i.asset_code)).toEqual(["TENT-01"]);
    expect(matchItems(items, "stove").map((i) => i.asset_code)).toEqual(["STOVE-01"]);
    expect(matchItems(items, "  ")).toEqual([]);
  });
});

describe("offline detection", () => {
  it("treats no connection or a network TypeError as offline", () => {
    expect(looksOffline(false)).toBe(true);
    expect(looksOffline(true, new TypeError("Failed to fetch"))).toBe(true);
    expect(looksOffline(true, new Error("boom"))).toBe(false);
  });
});
