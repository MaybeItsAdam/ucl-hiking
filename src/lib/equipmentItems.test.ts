import { describe, expect, it } from "vitest";
import {
  assetCodePrefix,
  clampAt,
  cleanClientId,
  describeDbError,
  nextAssetCode,
  normalizeAssetCode,
  normalizeTagUid,
  parseActionInput,
  parseCommissionInput,
  planAction,
  toBatchResult,
  toSummary,
  type LoanRequestContext,
} from "./equipmentItems";

const NOW = new Date("2026-10-07T12:00:00Z");
const AT = "2026-10-07T11:00:00.000Z";

describe("normalizeTagUid", () => {
  it.each([
    ["04a12b3c4d5e6f", "04:A1:2B:3C:4D:5E:6F"],
    ["04:a1:2b:3c:4d:5e:6f", "04:A1:2B:3C:4D:5E:6F"],
    ["04 A1 2B 3C 4D 5E 6F", "04:A1:2B:3C:4D:5E:6F"],
    ["04-A1-2B-3C-4D-5E-6F", "04:A1:2B:3C:4D:5E:6F"],
    ["  de:ad:be:ef  ", "DE:AD:BE:EF"],
    ["00112233445566778899", "00:11:22:33:44:55:66:77:88:99"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeTagUid(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "04a12b", // 3 bytes
    "0011223344556677889900", // 11 bytes
    "04a12b3", // odd
    "4:A1:2B:3C", // not whole bytes
    "04:A1:2G:3C",
    "hello world",
  ])("rejects %j", (input) => {
    expect(normalizeTagUid(input)).toBeNull();
  });

  it("matches the database's format", () => {
    const canonical = normalizeTagUid("04a12b3c4d5e6f")!;
    expect(/^([0-9A-F]{2}:){3,9}[0-9A-F]{2}$/.test(canonical)).toBe(true);
  });
});

describe("asset codes", () => {
  it("makes a prefix from the type name", () => {
    expect(assetCodePrefix("Tent")).toBe("TENT");
    expect(assetCodePrefix("Sleeping bag")).toBe("SLEEP-BAG");
    expect(assetCodePrefix("Head torch (spare)")).toBe("HEAD-TORCH");
    expect(assetCodePrefix("!!!")).toBe("KIT");
  });

  it("numbers after the highest used", () => {
    expect(nextAssetCode("TENT", [])).toBe("TENT-01");
    expect(nextAssetCode("TENT", ["TENT-01", "TENT-07", "TENT-POLE-02", "TENTX-09"])).toBe("TENT-08");
    expect(nextAssetCode("SLEEP-BAG", ["SLEEP-BAG-02"])).toBe("SLEEP-BAG-03");
  });

  it("normalizes typed codes", () => {
    expect(normalizeAssetCode(" tent-03 ")).toBe("TENT-03");
    expect(normalizeAssetCode("tent 3")).toBe("TENT-3");
    expect(normalizeAssetCode("tent_3")).toBeNull();
    expect(normalizeAssetCode("")).toBeNull();
  });
});

describe("clampAt", () => {
  it("keeps a past time", () => {
    expect(clampAt(AT, NOW)).toBe(AT);
  });
  it("pulls a future time back to now", () => {
    expect(clampAt("2026-10-08T00:00:00Z", NOW)).toBe(NOW.toISOString());
  });
  it("uses now for missing or junk", () => {
    expect(clampAt(undefined, NOW)).toBe(NOW.toISOString());
    expect(clampAt("yesterday-ish", NOW)).toBe(NOW.toISOString());
  });
});

describe("cleanClientId", () => {
  it("accepts a short string and rejects the rest", () => {
    expect(cleanClientId(" abc ")).toBe("abc");
    expect(cleanClientId("")).toBeNull();
    expect(cleanClientId(42)).toBeNull();
    expect(cleanClientId("x".repeat(129))).toBeNull();
  });
});

describe("parseActionInput", () => {
  it("reads each action", () => {
    expect(parseActionInput({ action: "check_out", requestId: "r1" })).toEqual({
      ok: true,
      input: { action: "check_out", requestId: "r1" },
    });
    expect(parseActionInput({ action: "check_in", condition: "fair", notes: " torn fly " })).toEqual({
      ok: true,
      input: { action: "check_in", condition: "fair", notes: "torn fly" },
    });
    expect(parseActionInput({ action: "audit", location: "Locker B" })).toEqual({
      ok: true,
      input: { action: "audit", location: "Locker B" },
    });
    expect(parseActionInput({ action: "flag", condition: "needs_repair" })).toEqual({
      ok: true,
      input: { action: "flag", condition: "needs_repair", notes: undefined },
    });
  });

  it("refuses what it can't use", () => {
    expect(parseActionInput({ action: "check_out" }).ok).toBe(false);
    expect(parseActionInput({ action: "flag" }).ok).toBe(false);
    expect(parseActionInput({ action: "check_in", condition: "excellent" }).ok).toBe(false);
    expect(parseActionInput({ action: "tagged" }).ok).toBe(false);
    expect(parseActionInput(null).ok).toBe(false);
  });
});

describe("parseCommissionInput", () => {
  it("normalizes the tag and code", () => {
    const parsed = parseCommissionInput({ tagUid: "04a12b3c", equipmentId: "e1", assetCode: "tent-03", label: "Tent #3" });
    expect(parsed).toEqual({
      ok: true,
      input: { tagUid: "04:A1:2B:3C", equipmentId: "e1", assetCode: "TENT-03", label: "Tent #3", location: undefined, notes: undefined },
    });
  });
  it("allows an untagged item and a generated code", () => {
    const parsed = parseCommissionInput({ equipmentId: "e1" });
    expect(parsed.ok && parsed.input.tagUid).toBeNull();
    expect(parsed.ok && parsed.input.assetCode).toBeNull();
  });
  it("refuses a bad tag or no type", () => {
    expect(parseCommissionInput({ tagUid: "zz", equipmentId: "e1" }).ok).toBe(false);
    expect(parseCommissionInput({ tagUid: "04a12b3c" }).ok).toBe(false);
  });
});

const tent = {
  asset_code: "TENT-03",
  label: "Tent #3",
  status: "available" as const,
  condition: "good" as const,
  equipment_id: "tents",
  equipment_name: "Tent",
  loan_request_id: null as string | null,
};

function loan(overrides: Partial<LoanRequestContext> = {}): LoanRequestContext {
  return {
    id: "r1",
    status: "approved",
    equipment_id: "tents",
    equipment_name: "Tent",
    quantity: 2,
    borrower: "Ada",
    itemsOut: 0,
    ...overrides,
  };
}

describe("planAction: check_out", () => {
  const input = { action: "check_out" as const, requestId: "r1" };

  it("puts an available item on the loan", () => {
    const plan = planAction(tent, input, AT, loan());
    expect(plan).toMatchObject({ ok: true, noop: false, patch: { status: "on_loan", loan_request_id: "r1" } });
    expect(plan.ok && !plan.noop && plan.event).toMatchObject({ action: "check_out", request_id: "r1" });
  });

  it("is a no-op when already out on the same loan", () => {
    expect(planAction({ ...tent, status: "on_loan", loan_request_id: "r1" }, input, AT, loan())).toMatchObject({ ok: true, noop: true });
  });

  it("refuses an item out on another loan", () => {
    const plan = planAction({ ...tent, status: "on_loan", loan_request_id: "r9" }, input, AT, loan());
    expect(plan).toMatchObject({ ok: false, status: 409 });
    expect(!plan.ok && plan.error).toMatch(/another loan/);
  });

  it("refuses an item under repair", () => {
    const plan = planAction({ ...tent, status: "maintenance" }, input, AT, loan());
    expect(!plan.ok && plan.error).toMatch(/repair/);
  });

  it("lets a missing item out (the scan found it)", () => {
    expect(planAction({ ...tent, status: "missing" }, input, AT, loan())).toMatchObject({ ok: true, noop: false });
  });

  it("needs an approved request for the same type with room left", () => {
    expect(planAction(tent, input, AT, null)).toMatchObject({ ok: false, status: 404 });
    expect(!planAction(tent, input, AT, loan({ status: "pending" })).ok).toBe(true);
    const returned = planAction(tent, input, AT, loan({ status: "returned" }));
    expect(!returned.ok && returned.error).toMatch(/returned/);
    const wrong = planAction(tent, input, AT, loan({ equipment_id: "stoves", equipment_name: "Stove" }));
    expect(!wrong.ok && wrong.error).toBe("Tent #3 is a Tent, but this request is for Stove.");
    const full = planAction(tent, input, AT, loan({ quantity: 2, itemsOut: 2 }));
    expect(!full.ok && full.error).toMatch(/already been handed over/);
  });
});

describe("planAction: check_in", () => {
  const out = { ...tent, status: "on_loan" as const, loan_request_id: "r1" };

  it("returns the item and clears the loan", () => {
    const plan = planAction(out, { action: "check_in" }, AT);
    expect(plan).toMatchObject({ ok: true, noop: false, patch: { status: "available", loan_request_id: null } });
    expect(plan.ok && !plan.noop && plan.event.request_id).toBe("r1");
  });

  it("sends a damaged item to maintenance with its notes", () => {
    const plan = planAction(out, { action: "check_in", condition: "needs_repair", notes: "pole snapped" }, AT);
    expect(plan).toMatchObject({
      ok: true,
      patch: { status: "maintenance", condition: "needs_repair", notes: "pole snapped", loan_request_id: null },
    });
  });

  it("keeps an item already needing repair in maintenance", () => {
    const plan = planAction({ ...out, condition: "needs_repair" }, { action: "check_in" }, AT);
    expect(plan).toMatchObject({ ok: true, patch: { status: "maintenance" } });
  });

  it("is a no-op for an item already in", () => {
    expect(planAction(tent, { action: "check_in" }, AT)).toMatchObject({ ok: true, noop: true });
  });
});

describe("planAction: audit and flag", () => {
  it("stamps an audit and finds a missing item", () => {
    expect(planAction({ ...tent, status: "missing" }, { action: "audit", location: "Locker B" }, AT)).toMatchObject({
      ok: true,
      patch: { last_audited_at: AT, location: "Locker B", status: "available" },
    });
    const plain = planAction(tent, { action: "audit" }, AT);
    expect(plain.ok && !plain.noop && plain.patch).toEqual({ last_audited_at: AT });
  });

  it("flags for repair, and back", () => {
    expect(planAction(tent, { action: "flag", condition: "needs_repair" }, AT)).toMatchObject({
      ok: true,
      patch: { condition: "needs_repair", status: "maintenance" },
    });
    expect(planAction({ ...tent, status: "maintenance" }, { action: "flag", condition: "fair" }, AT)).toMatchObject({
      ok: true,
      patch: { condition: "fair", status: "available" },
    });
  });

  it("leaves an item on loan on loan when flagged", () => {
    const plan = planAction({ ...tent, status: "on_loan", loan_request_id: "r1" }, { action: "flag", condition: "needs_repair" }, AT);
    expect(plan.ok && !plan.noop && plan.patch).toEqual({ condition: "needs_repair" });
  });
});

describe("describeDbError", () => {
  it("explains each guard", () => {
    expect(describeDbError({ message: "item_limit", details: "total=4 tagged=4" }, { typeName: "Tent" }).error).toBe(
      "Every Tent is already tagged (4 in total). Raise the total for Tent before tagging another.",
    );
    expect(describeDbError({ message: "loan_full" }).status).toBe(409);
    expect(describeDbError({ message: "loan_not_approved" }).error).toMatch(/isn't approved/);
    expect(describeDbError({ message: "stale_item" }, { itemName: "Tent #3" }).error).toMatch(/^Tent #3 was changed/);
    expect(describeDbError({ message: "boom" }).status).toBe(500);
  });
});

describe("toSummary", () => {
  const row = {
    id: "i1",
    equipment_id: "tents",
    tag_uid: "04:A1:2B:3C",
    asset_code: "TENT-03",
    label: null,
    location: "Locker B",
    status: "on_loan" as const,
    condition: "good" as const,
    last_audited_at: null,
    notes: null,
    updated_at: AT,
    loan_request_id: "r1",
    equipment: { name: "Tent", category: "Tents & Shelter" },
    loan: { id: "r1", start_date: "2026-10-10", end_date: "2026-10-12", borrower_name: "Old Name", member: { full_name: "Ada" } },
  };

  it("flattens the type and loan", () => {
    expect(toSummary(row)).toMatchObject({
      equipment_name: "Tent",
      category: "Tents & Shelter",
      loan: { request_id: "r1", borrower: "Ada", start_date: "2026-10-10", end_date: "2026-10-12" },
    });
  });

  it("falls back to the borrower snapshot, and drops a loan on an item that isn't out", () => {
    expect(toSummary({ ...row, loan: { ...row.loan, member: null } }).loan?.borrower).toBe("Old Name");
    expect(toSummary({ ...row, status: "available" }).loan).toBeNull();
  });
});

describe("toBatchResult", () => {
  it("keeps the client id on both outcomes", () => {
    expect(toBatchResult("c1", { ok: false, status: 404, error: "nope", unregistered: true, uid: "04:A1:2B:3C" })).toEqual({
      clientId: "c1",
      ok: false,
      error: "nope",
      unregistered: true,
      uid: "04:A1:2B:3C",
    });
    expect(toBatchResult("c2", { ok: false, status: 409, error: "busy" })).toEqual({ clientId: "c2", ok: false, error: "busy" });
  });
});
