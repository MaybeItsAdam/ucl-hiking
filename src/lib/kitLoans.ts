import type { EquipmentRequestStatus } from "@/lib/types";

/**
 * Club kit and account deletion.
 *
 * A request's life: pending → booked (a pickup arranged, stock held) →
 * approved (kit handed over) → returned; or pending / booked → rejected /
 * cancelled. A principal can also cancel an approved loan (it restores stock).
 * "Overdue" is not a status: it is an approved loan past its end date. So
 * `approved` is the one status that means the kit is, or may be, with the
 * member; a member also has kit out while they hold an item passed to them on
 * someone else's loan (see lib/kitCustody).
 *
 * The database enforces the important part (migration
 * 20260929000000_account_deletion_kit_guard): a member with an approved loan
 * cannot be deleted by any code path, and `delete_member_account()` checks and
 * deletes in one transaction. This module holds the matching app-side rules and
 * the words the member sees.
 */

/** Statuses that mean the member has, or may have, club kit. */
export const OUTSTANDING_LOAN_STATUSES = ["approved"] as const satisfies readonly EquipmentRequestStatus[];

/**
 * Days after a loan ends before the borrower can delete their account, so a
 * principal has time to check the kit that came back (a tent missing its poles
 * turns up at the next kit check, not at the handover). Enforced in the
 * database with this value, so the member is told the number that is applied.
 */
export const KIT_COOL_OFF_DAYS = 7;

export interface LoanItem {
  id: string;
  name: string;
  quantity: number;
}

export type DeletionBlock =
  | { reason: "on_loan"; items: (LoanItem & { endDate: string | null })[] }
  | { reason: "cooling_off"; until: string; items: LoanItem[] };

export type DeletionResult = { status: "deleted"; cancelledRequests: number } | { status: "not_found" } | ({ status: "blocked" } & DeletionBlock);

function toItems(raw: unknown): (LoanItem & { endDate: string | null })[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => ({
      id: String(row.id ?? ""),
      name: typeof row.name === "string" && row.name ? row.name : "Club kit",
      quantity: typeof row.quantity === "number" && row.quantity > 0 ? row.quantity : 1,
      endDate: typeof row.end_date === "string" ? row.end_date : null,
    }));
}

/** Read what `delete_member_account()` returned. Anything unrecognised is null. */
export function parseDeletionResult(raw: unknown): DeletionResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  switch (r.status) {
    case "deleted":
      return { status: "deleted", cancelledRequests: typeof r.cancelled_requests === "number" ? r.cancelled_requests : 0 };
    case "not_found":
      return { status: "not_found" };
    case "on_loan":
      return { status: "blocked", reason: "on_loan", items: toItems(r.items) };
    case "cooling_off":
      if (typeof r.until !== "string") return null;
      return {
        status: "blocked",
        reason: "cooling_off",
        until: r.until,
        items: toItems(r.items).map(({ id, name, quantity }) => ({ id, name, quantity })),
      };
    default:
      return null;
  }
}

export interface LoanRow {
  id: string;
  status: string;
  quantity: number;
  end_date: string | null;
  loan_closed_at: string | null;
  equipment: { name: string } | null;
}

/**
 * The same rules as `delete_member_account()`, applied to rows already read, so
 * the account page can explain up front. The database has the final say.
 */
export function deletionBlock(rows: LoanRow[], now: Date = new Date(), coolOffDays = KIT_COOL_OFF_DAYS): DeletionBlock | null {
  const onLoan = rows.filter((r) => (OUTSTANDING_LOAN_STATUSES as readonly string[]).includes(r.status));
  if (onLoan.length) {
    return {
      reason: "on_loan",
      items: onLoan
        .map((r) => ({ id: r.id, name: r.equipment?.name ?? "Club kit", quantity: r.quantity, endDate: r.end_date }))
        .sort((a, b) => (a.endDate ?? "").localeCompare(b.endDate ?? "")),
    };
  }
  if (coolOffDays <= 0) return null;
  const windowMs = coolOffDays * 24 * 60 * 60 * 1000;
  const recent = rows
    .filter((r) => r.loan_closed_at && Date.parse(r.loan_closed_at) > now.getTime() - windowMs)
    .sort((a, b) => Date.parse(b.loan_closed_at!) - Date.parse(a.loan_closed_at!));
  if (!recent.length) return null;
  return {
    reason: "cooling_off",
    until: new Date(Date.parse(recent[0].loan_closed_at!) + windowMs).toISOString(),
    items: recent.map((r) => ({ id: r.id, name: r.equipment?.name ?? "Club kit", quantity: r.quantity })),
  };
}

export function describeItem(item: LoanItem): string {
  return `${item.quantity > 1 ? `${item.quantity} × ` : ""}${item.name}`;
}

function londonDate(iso: string): string {
  // Date-only strings are calendar days already; don't let a timezone shift them.
  const value = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return value.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Europe/London" });
}

/** What the member is told, as a heading and a line of explanation. */
export function deletionBlockMessage(block: DeletionBlock): { title: string; detail: string } {
  if (block.reason === "on_loan") {
    return {
      title: "You still have club kit out on loan.",
      detail:
        "Give it back to a committee member and ask them to check it in, then you can delete your account. " +
        `Deletion opens ${KIT_COOL_OFF_DAYS} days after the last return, so the kit can be checked.`,
    };
  }
  return {
    title: `You can delete your account from ${londonDate(block.until)}.`,
    detail:
      `Kit you borrowed came back less than ${KIT_COOL_OFF_DAYS} days ago. The club keeps your account for ` +
      `${KIT_COOL_OFF_DAYS} days after a return so a principal can check the kit before the loan is closed off.`,
  };
}

/** A one-line version for the API's `error` field. */
export function deletionBlockSummary(block: DeletionBlock): string {
  const { title, detail } = deletionBlockMessage(block);
  const items = block.items.map(describeItem).join(", ");
  return `${title} ${block.reason === "on_loan" ? `On loan: ${items}. ` : ""}${detail}`;
}

/** Due-back line for an item on loan. */
export function dueLine(endDate: string | null, today: string): string | null {
  if (!endDate) return null;
  return endDate < today ? `overdue since ${londonDate(endDate)}` : `due back ${londonDate(endDate)}`;
}

// The loan's state machine lives with the custody rules.
export { canTransitionRequest, type RequestTransition } from "@/lib/kitCustody";
