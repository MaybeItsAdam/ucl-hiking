import { describe, expect, it } from "vitest";
import {
  QUEUE_KEY,
  auditSummary,
  chunk,
  enqueue,
  handoverProgress,
  looksOffline,
  isPendingItem,
  matchItems,
  mergeAfterFlush,
  previewScan,
  projectQueue,
  readQueue,
  requestsWithRoom,
  settleQueue,
  writeQueue,
  type BatchOp,
  type ProjectionRequest,
  type QueuedScan,
} from "./kitScan";
import type { ItemSummary } from "./equipmentItems";

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
    expect(looksOffline(true, new DOMException("No answer in time", "TimeoutError"))).toBe(true);
    expect(looksOffline(true, new DOMException("Aborted", "AbortError"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The queue played over the phone's copy of the kit
// ---------------------------------------------------------------------------

const AT = "2026-11-16T09:00:00Z";
const item = (id: string, over: Partial<ItemSummary> = {}): ItemSummary => ({
  id,
  equipment_id: "tent",
  equipment_name: "Tent",
  category: "Camping",
  tag_uid: `TAG-${id}`,
  asset_code: `TENT-${id}`,
  label: null,
  location: "Kit room",
  status: "available",
  condition: "good",
  last_audited_at: null,
  notes: null,
  updated_at: "2026-11-01T00:00:00Z",
  loan: null,
  ...over,
});
const loan = (over: Partial<ProjectionRequest> = {}): ProjectionRequest => ({
  id: "req",
  status: "approved",
  equipment_id: "tent",
  quantity: 2,
  start_date: "2026-11-20",
  end_date: "2026-11-22",
  equipment: { name: "Tent" },
  items: [],
  ...over,
});
const kinds = [{ id: "tent", name: "Tent", category: "Camping" }, { id: "stove", name: "Stove" }];
type Without<K extends keyof BatchOp> = BatchOp extends infer T ? (T extends BatchOp ? Omit<T, K> : never) : never;
const q = (op: Without<"at">): QueuedScan => ({ op: { at: AT, ...op } as BatchOp, label: op.clientId });

describe("projectQueue", () => {
  it("returns the list untouched with nothing waiting", () => {
    const items = [item("01")];
    expect(projectQueue(items, [], [loan()], kinds).items).toBe(items);
  });

  it("shows a queued handover as on loan, against that request, and counts it", () => {
    const { items, queuedOut } = projectQueue(
      [item("01"), item("02")],
      [q({ clientId: "a", action: "check_out", uid: "TAG-01", requestId: "req" })],
      [loan()],
      kinds,
    );
    expect(items[0]).toMatchObject({ status: "on_loan", loan: { request_id: "req", start_date: "2026-11-20" }, updated_at: AT });
    expect(items[1].status).toBe("available");
    expect(queuedOut.get("req")).toBe(1);
  });

  it("plays scans in order: out, then back in needing repair", () => {
    const { items, queuedOut } = projectQueue(
      [item("01")],
      [
        q({ clientId: "a", action: "check_out", itemId: "01", requestId: "req" }),
        q({ clientId: "b", action: "check_in", uid: "TAG-01", condition: "needs_repair" }),
      ],
      [loan()],
      kinds,
    );
    expect(items[0]).toMatchObject({ status: "maintenance", condition: "needs_repair", loan: null });
    expect(queuedOut.get("req")).toBe(1);
  });

  it("stops counting a request once it is full, and leaves refused scans as they were", () => {
    const { items, queuedOut } = projectQueue(
      [item("01"), item("02"), item("03")],
      [
        q({ clientId: "a", action: "check_out", uid: "TAG-01", requestId: "req" }),
        q({ clientId: "b", action: "check_out", uid: "TAG-02", requestId: "req" }),
        q({ clientId: "c", action: "check_out", uid: "TAG-03", requestId: "req" }),
      ],
      [loan({ quantity: 2 })],
      kinds,
    );
    expect(items.map((i) => i.status)).toEqual(["on_loan", "on_loan", "available"]);
    expect(queuedOut.get("req")).toBe(2);
  });

  it("marks audited items seen, moves them, and finds missing ones", () => {
    const { items } = projectQueue(
      [item("01", { status: "missing" })],
      [q({ clientId: "a", action: "audit", uid: "TAG-01", location: "Shelf B" })],
      [],
      kinds,
    );
    expect(items[0]).toMatchObject({ status: "available", location: "Shelf B", last_audited_at: AT });
  });

  it("lists a tag tagged offline as a pending item, so scanning it again finds it", () => {
    const { items } = projectQueue(
      [item("01")],
      [q({ clientId: "t1", action: "tagged", uid: "NEW", tagUid: "NEW", equipmentId: "stove", label: "Blue" })],
      [],
      kinds,
    );
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ tag_uid: "NEW", equipment_name: "Stove", category: "", label: "Blue", status: "available" });
    expect(isPendingItem(items[1])).toBe(true);
    expect(isPendingItem(items[0])).toBe(false);
  });

  it("doesn't list a queued tag that is already on an item", () => {
    const { items } = projectQueue(
      [item("01")],
      [q({ clientId: "t1", action: "tagged", tagUid: "TAG-01", equipmentId: "tent" })],
      [],
      kinds,
    );
    expect(items).toHaveLength(1);
  });

  it("applies later scans to a pending item by its tag", () => {
    const { items } = projectQueue(
      [],
      [
        q({ clientId: "t1", action: "tagged", tagUid: "NEW", equipmentId: "tent" }),
        q({ clientId: "a", action: "flag", uid: "NEW", condition: "needs_repair" }),
      ],
      [],
      kinds,
    );
    expect(items[0]).toMatchObject({ status: "maintenance", condition: "needs_repair" });
  });
});

describe("previewScan", () => {
  const op = (body: Without<"at" | "clientId">) => ({ clientId: "x", at: AT, ...body }) as BatchOp;

  it("leaves tags it doesn't know to the server", () => {
    expect(previewScan([item("01")], op({ action: "audit", uid: "STRANGER" }), [])).toEqual({ verdict: "unknown" });
  });

  it("refuses the wrong kind of kit outright", () => {
    const stove = item("09", { equipment_id: "stove", equipment_name: "Stove", asset_code: "STOVE-09" });
    expect(previewScan([stove], op({ action: "check_out", uid: "TAG-09", requestId: "req" }), [loan()])).toEqual({
      verdict: "refuse",
      error: "STOVE-09 is a Stove, but this request is for Tent.",
    });
  });

  it("says a repeat handover is already done rather than queueing it", () => {
    const out = item("01", { status: "on_loan", loan: { request_id: "req", borrower: null, start_date: "", end_date: "" } });
    const preview = previewScan([out], op({ action: "check_out", uid: "TAG-01", requestId: "req" }), [loan()]);
    expect(preview.verdict).toBe("noop");
  });

  it("doubts, but doesn't refuse, what may be out of date", () => {
    const elsewhere = item("01", { status: "on_loan", loan: { request_id: "other", borrower: null, start_date: "", end_date: "" } });
    expect(previewScan([elsewhere], op({ action: "check_out", uid: "TAG-01", requestId: "req" }), [loan()]).verdict).toBe("doubt");
    // A request newer than the phone's copy.
    expect(previewScan([item("01")], op({ action: "check_out", uid: "TAG-01", requestId: "new" }), [loan()]).verdict).toBe("doubt");
    // Full, counting what's already queued.
    const full = previewScan([item("01")], op({ action: "check_out", uid: "TAG-01", requestId: "req" }), [loan({ quantity: 1 })], new Map([["req", 1]]));
    expect(full.verdict).toBe("doubt");
  });

  it("returns the item as it will be", () => {
    const preview = previewScan([item("01")], op({ action: "check_out", itemId: "01", requestId: "req" }), [loan()]);
    expect(preview).toMatchObject({ verdict: "apply", item: { status: "on_loan" } });
  });
});

describe("requestsWithRoom", () => {
  it("counts handovers waiting to send", () => {
    const r = { id: "req", status: "approved", equipment_id: "tent", quantity: 2, items: [{ id: "01" }] };
    expect(requestsWithRoom([r], "tent")).toHaveLength(1);
    expect(requestsWithRoom([r], "tent", new Map([["req", 1]]))).toHaveLength(0);
  });
});
