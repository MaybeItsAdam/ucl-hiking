import { describe, expect, it } from "vitest";
import {
  KIT_COOL_OFF_DAYS,
  canTransitionRequest,
  deletionBlock,
  deletionBlockMessage,
  deletionBlockSummary,
  dueLine,
  parseDeletionResult,
  type LoanRow,
} from "./kitLoans";

const NOW = new Date("2026-09-29T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function row(overrides: Partial<LoanRow>): LoanRow {
  return {
    id: "r1",
    status: "returned",
    quantity: 1,
    end_date: "2026-09-20",
    loan_closed_at: null,
    equipment: { name: "Tent" },
    ...overrides,
  };
}

describe("deletionBlock", () => {
  it("blocks while kit is out, overdue or not, listing every item", () => {
    const block = deletionBlock(
      [
        row({ id: "a", status: "approved", end_date: "2026-10-05", equipment: { name: "Stove" } }),
        row({ id: "b", status: "approved", end_date: "2026-09-01", quantity: 2 }),
        row({ id: "c", status: "pending" }),
      ],
      NOW,
    );
    expect(block).toEqual({
      reason: "on_loan",
      items: [
        { id: "b", name: "Tent", quantity: 2, endDate: "2026-09-01" },
        { id: "a", name: "Stove", quantity: 1, endDate: "2026-10-05" },
      ],
    });
  });

  it("does not block on pending, rejected or cancelled requests alone", () => {
    expect(deletionBlock([row({ status: "pending" }), row({ status: "rejected" }), row({ status: "cancelled" })], NOW)).toBeNull();
  });

  it("waits the cool-off after the last return, then lets go", () => {
    const recent = new Date(NOW.getTime() - 2 * DAY).toISOString();
    const older = new Date(NOW.getTime() - 5 * DAY).toISOString();
    const block = deletionBlock([row({ id: "old", loan_closed_at: older }), row({ id: "new", loan_closed_at: recent })], NOW);
    expect(block?.reason).toBe("cooling_off");
    expect(block?.items.map((i) => i.id)).toEqual(["new", "old"]);
    expect(block && block.reason === "cooling_off" && block.until).toBe(
      new Date(Date.parse(recent) + KIT_COOL_OFF_DAYS * DAY).toISOString(),
    );

    const longAgo = new Date(NOW.getTime() - (KIT_COOL_OFF_DAYS + 1) * DAY).toISOString();
    expect(deletionBlock([row({ loan_closed_at: longAgo })], NOW)).toBeNull();
  });

  it("a loan still out outranks a cool-off", () => {
    const recent = new Date(NOW.getTime() - DAY).toISOString();
    expect(deletionBlock([row({ loan_closed_at: recent }), row({ id: "x", status: "approved" })], NOW)?.reason).toBe("on_loan");
  });
});

describe("parseDeletionResult", () => {
  it("reads each shape delete_member_account() returns", () => {
    expect(parseDeletionResult({ status: "deleted", cancelled_requests: 2 })).toEqual({ status: "deleted", cancelledRequests: 2 });
    expect(parseDeletionResult({ status: "not_found" })).toEqual({ status: "not_found" });
    expect(
      parseDeletionResult({ status: "on_loan", items: [{ id: "r", name: "Tent", quantity: 1, end_date: "2026-09-05" }] }),
    ).toEqual({ status: "blocked", reason: "on_loan", items: [{ id: "r", name: "Tent", quantity: 1, endDate: "2026-09-05" }] });
    expect(
      parseDeletionResult({
        status: "cooling_off",
        until: "2026-10-06T10:00:00+00:00",
        items: [{ id: "r", name: "Tent", quantity: 1, closed_at: "2026-09-29T10:00:00+00:00" }],
      }),
    ).toEqual({ status: "blocked", reason: "cooling_off", until: "2026-10-06T10:00:00+00:00", items: [{ id: "r", name: "Tent", quantity: 1 }] });
  });

  it("rejects anything else", () => {
    expect(parseDeletionResult(null)).toBeNull();
    expect(parseDeletionResult({ status: "maybe" })).toBeNull();
    expect(parseDeletionResult({ status: "cooling_off" })).toBeNull();
  });
});

describe("messages", () => {
  it("names the items and the cool-off", () => {
    const summary = deletionBlockSummary({
      reason: "on_loan",
      items: [{ id: "r", name: "Tent", quantity: 2, endDate: "2026-09-05" }],
    });
    expect(summary).toContain("2 × Tent");
    expect(summary).toContain(`${KIT_COOL_OFF_DAYS} days`);
    expect(deletionBlockMessage({ reason: "cooling_off", until: "2026-10-06T10:00:00Z", items: [] }).title).toBe(
      "You can delete your account from 6 October.",
    );
  });

  it("says overdue once the end date has passed", () => {
    expect(dueLine("2026-09-05", "2026-09-29")).toBe("overdue since 5 September");
    expect(dueLine("2026-10-05", "2026-09-29")).toBe("due back 5 October");
    expect(dueLine(null, "2026-09-29")).toBeNull();
  });
});

describe("canTransitionRequest", () => {
  const owner = { isOwner: true, isReviewer: false };
  const principal = { isOwner: false, isReviewer: true };

  it("lets a borrower withdraw a pending request but not cancel a loan that is out", () => {
    expect(canTransitionRequest("pending", "cancelled", owner)).toBe(true);
    expect(canTransitionRequest("approved", "cancelled", owner)).toBe(false);
    expect(canTransitionRequest("approved", "returned", owner)).toBe(false);
    expect(canTransitionRequest("pending", "approved", owner)).toBe(false);
  });

  it("lets a principal run the lifecycle", () => {
    expect(canTransitionRequest("pending", "approved", principal)).toBe(true);
    expect(canTransitionRequest("pending", "rejected", principal)).toBe(true);
    expect(canTransitionRequest("approved", "returned", principal)).toBe(true);
    expect(canTransitionRequest("approved", "cancelled", principal)).toBe(true);
  });

  it("never reopens a closed request", () => {
    for (const from of ["returned", "cancelled", "rejected"] as const) {
      for (const to of ["approved", "rejected", "returned", "cancelled"] as const) {
        expect(canTransitionRequest(from, to, principal)).toBe(false);
      }
    }
    expect(canTransitionRequest("approved", "approved", principal)).toBe(false);
  });
});
