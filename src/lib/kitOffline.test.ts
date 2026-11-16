import { describe, expect, it } from "vitest";
import { LENDER_KEEP_MS, LENDER_KEY, readLenderSnapshot, storeLenderSnapshot } from "./kitOffline";
import type { Equipment, EquipmentRequest } from "./types";

class MemoryStorage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

const tent = { id: "tent", name: "Tent" } as Equipment;
const request = (id: string, status: EquipmentRequest["status"]): EquipmentRequest =>
  ({
    id,
    member_id: "m1",
    equipment_id: "tent",
    quantity: 2,
    start_date: "2026-11-20",
    end_date: "2026-11-22",
    purpose: "Snowdon weekend with my flatmates",
    status,
    notes: "Collect after 5",
    reviewed_by: null,
    reviewed_at: null,
    created_at: "",
    updated_at: "",
    member: { id: "m1", email: "sam@example.com", full_name: "Sam Hill" },
    equipment: tent,
    items: [{ id: "01", asset_code: "TENT-01", label: null }],
  }) as unknown as EquipmentRequest;

describe("lender snapshot", () => {
  const NOW = Date.parse("2026-11-16T09:00:00Z");

  it("keeps approved loans only, with the borrower's name and nothing else about them", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    storeLenderSnapshot(storage, [tent], [request("a", "approved"), request("p", "pending"), request("r", "returned")], NOW);
    const saved = readLenderSnapshot(storage, NOW)!;
    expect(saved.equipment).toEqual([tent]);
    expect(saved.requests.map((r) => r.id)).toEqual(["a"]);
    const [kept] = saved.requests;
    expect(kept).toMatchObject({ borrower_name: "Sam Hill", member: null, member_id: null, borrower_email: null, notes: null, purpose: "" });
    expect(kept.items).toHaveLength(1);
    expect(JSON.stringify(saved)).not.toContain("sam@example.com");
  });

  it("forgets the copy two weeks on", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    storeLenderSnapshot(storage, [tent], [], NOW);
    expect(readLenderSnapshot(storage, NOW + LENDER_KEEP_MS - 1)).not.toBeNull();
    expect(readLenderSnapshot(storage, NOW + LENDER_KEEP_MS + 1)).toBeNull();
    expect(storage.getItem(LENDER_KEY)).toBeNull();
  });

  it("reads garbage as nothing", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    storage.setItem(LENDER_KEY, "{nope");
    expect(readLenderSnapshot(storage, NOW)).toBeNull();
  });
});
