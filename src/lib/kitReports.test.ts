import { describe, expect, it } from "vitest";
import {
  MAX_DESCRIPTION,
  MAX_RESOLUTION_NOTE,
  REPORT_WINDOW_DAYS,
  canReportOn,
  isMissingTable,
  parseReportInput,
  parseResolveInput,
  reportMessage,
  suggestedCondition,
  toReport,
} from "./kitReports";

const NOW = new Date("2026-11-08T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const REQ = "6f1c2d3e-4a5b-4c6d-8e7f-901234567890";
const ITEM = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";

describe("canReportOn", () => {
  it("allows a loan that is out, overdue or not", () => {
    expect(canReportOn({ status: "approved" }, NOW)).toBe(true);
  });

  it("allows a returned loan within the window, by when it was closed", () => {
    const closed = new Date(NOW.getTime() - (REPORT_WINDOW_DAYS - 1) * DAY).toISOString();
    expect(canReportOn({ status: "returned", loan_closed_at: closed }, NOW)).toBe(true);
  });

  it("closes the window after the set days", () => {
    const closed = new Date(NOW.getTime() - (REPORT_WINDOW_DAYS + 1) * DAY).toISOString();
    expect(canReportOn({ status: "returned", loan_closed_at: closed }, NOW)).toBe(false);
  });

  it("falls back to updated_at when the loan has no close stamp", () => {
    const recent = new Date(NOW.getTime() - DAY).toISOString();
    expect(canReportOn({ status: "returned", loan_closed_at: null, updated_at: recent }, NOW)).toBe(true);
    expect(canReportOn({ status: "returned" }, NOW)).toBe(false);
  });

  it("never allows a loan that kit didn't go out on", () => {
    for (const status of ["pending", "rejected", "cancelled"]) {
      expect(canReportOn({ status, loan_closed_at: NOW.toISOString(), updated_at: NOW.toISOString() }, NOW)).toBe(false);
    }
  });
});

describe("parseReportInput", () => {
  const good = { requestId: REQ, severity: "needs_repair", description: "  Bent pole  " };

  it("reads a report, trimming the description", () => {
    expect(parseReportInput(good)).toEqual({
      ok: true,
      input: { requestId: REQ, severity: "needs_repair", description: "Bent pole", itemId: null },
    });
  });

  it("takes an optional item, and treats blank as none", () => {
    expect(parseReportInput({ ...good, itemId: ITEM })).toMatchObject({ ok: true, input: { itemId: ITEM } });
    expect(parseReportInput({ ...good, itemId: "" })).toMatchObject({ ok: true, input: { itemId: null } });
    expect(parseReportInput({ ...good, itemId: "TENT-01" })).toEqual({ ok: false, error: "That item isn't on this loan." });
  });

  it("needs a loan id that is a uuid", () => {
    expect(parseReportInput({ ...good, requestId: "1; drop table" }).ok).toBe(false);
    expect(parseReportInput({ ...good, requestId: undefined }).ok).toBe(false);
  });

  it("needs one of the three severities", () => {
    expect(parseReportInput({ ...good, severity: "awful" }).ok).toBe(false);
    for (const severity of ["minor", "needs_repair", "unusable"]) {
      expect(parseReportInput({ ...good, severity }).ok).toBe(true);
    }
  });

  it("needs a description, and not an essay", () => {
    expect(parseReportInput({ ...good, description: "   " })).toEqual({ ok: false, error: "Say what's wrong." });
    expect(parseReportInput({ ...good, description: "x".repeat(MAX_DESCRIPTION) }).ok).toBe(true);
    expect(parseReportInput({ ...good, description: "x".repeat(MAX_DESCRIPTION + 1) }).ok).toBe(false);
  });

  it("rejects a body that isn't an object", () => {
    expect(parseReportInput(null).ok).toBe(false);
    expect(parseReportInput("broken").ok).toBe(false);
  });
});

describe("parseResolveInput", () => {
  it("takes nothing at all", () => {
    expect(parseResolveInput({})).toEqual({ ok: true, input: { note: null, condition: null } });
    expect(parseResolveInput(null)).toEqual({ ok: true, input: { note: null, condition: null } });
  });

  it("reads a note and a condition", () => {
    expect(parseResolveInput({ note: " New pole fitted ", condition: "good" })).toEqual({
      ok: true,
      input: { note: "New pole fitted", condition: "good" },
    });
  });

  it("rejects an unknown condition and an overlong note", () => {
    expect(parseResolveInput({ condition: "excellent" }).ok).toBe(false);
    expect(parseResolveInput({ note: "x".repeat(MAX_RESOLUTION_NOTE + 1) }).ok).toBe(false);
  });
});

describe("suggestedCondition", () => {
  it("grades minor as fair and anything worse as needs repair", () => {
    expect(suggestedCondition("minor")).toBe("fair");
    expect(suggestedCondition("needs_repair")).toBe("needs_repair");
    expect(suggestedCondition("unusable")).toBe("needs_repair");
  });
});

describe("isMissingTable", () => {
  it("spots the table not being there yet", () => {
    expect(isMissingTable({ code: "PGRST205", message: "Could not find the table" })).toBe(true);
    expect(isMissingTable({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(
      isMissingTable({ message: 'relation "public.equipment_condition_reports" does not exist' }),
    ).toBe(true);
  });

  it("leaves other errors alone", () => {
    expect(isMissingTable(null)).toBe(false);
    expect(isMissingTable({ code: "23514", message: "violates check constraint" })).toBe(false);
  });
});

describe("reportMessage", () => {
  it("leads with how bad and which item", () => {
    expect(
      reportMessage({ severity: "unusable", description: "Stove won't light", equipmentName: "Stove", itemCode: "STOVE-02", reporter: "Sam" }),
    ).toEqual({ title: "Can't be used: Stove STOVE-02", body: "Sam: Stove won't light" });
  });

  it("shortens a long description", () => {
    const { body } = reportMessage({ severity: "minor", description: "x".repeat(300), equipmentName: "Tent", itemCode: null, reporter: "Sam" });
    expect(body.length).toBeLessThanOrEqual("Sam: ".length + 140);
    expect(body.endsWith("…")).toBe(true);
  });
});

describe("toReport", () => {
  it("flattens the joins, and keeps a deleted borrower's name", () => {
    const report = toReport({
      id: "r1",
      request_id: REQ,
      equipment_id: "e1",
      item_id: ITEM,
      severity: "minor",
      description: "Torn stuff sack",
      status: "open",
      resolved_at: null,
      resolution_note: null,
      created_at: NOW.toISOString(),
      equipment: [{ name: "Tent" }] as unknown as { name: string },
      item: { asset_code: "TENT-01", label: null },
      reporter: null,
      loan: { start_date: "2026-11-01", end_date: "2026-11-03", status: "returned", borrower_name: "Alex" },
    });
    expect(report).toMatchObject({
      equipment_name: "Tent",
      item: { asset_code: "TENT-01", label: null },
      reporter: "Alex",
      loan: { start_date: "2026-11-01", end_date: "2026-11-03", status: "returned" },
    });
  });
});
