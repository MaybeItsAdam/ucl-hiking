import type { SupabaseClient } from "@supabase/supabase-js";
import { isItemCondition, type ItemCondition } from "@/lib/equipmentItems";

/**
 * Borrowers telling the principals that kit is damaged: a report against one
 * of their loans, optionally naming the tagged item it's about.
 *
 * A report is a note, not a change to the kit. A principal resolves it, and can
 * re-grade the item while doing so; that goes through the item's own flag
 * action (applyItemAction), so the item's event log stays its one history.
 *
 * The table comes with migration 20261108000000_equipment_condition_reports.
 * Until that has run, reads come back empty and writes say the feature isn't
 * on yet, so the Equipment page keeps working.
 */

export const REPORT_SEVERITIES = ["minor", "needs_repair", "unusable"] as const;
export type ReportSeverity = (typeof REPORT_SEVERITIES)[number];
export type ReportStatus = "open" | "resolved";

export const SEVERITY_LABELS: Record<ReportSeverity, string> = {
  minor: "Minor",
  needs_repair: "Needs repair",
  unusable: "Can't be used",
};

/** Days after a loan is returned that the borrower can still report a problem. */
export const REPORT_WINDOW_DAYS = 14;
export const MAX_DESCRIPTION = 1000;
export const MAX_RESOLUTION_NOTE = 500;
/** Open reports one loan can have at once, so a stuck button can't flood the list. */
export const MAX_OPEN_PER_REQUEST = 5;

export const REPORTS_UNAVAILABLE = "Problem reports aren't switched on yet. Tell a principal directly for now.";

export interface ConditionReport {
  id: string;
  request_id: string;
  equipment_id: string;
  equipment_name: string;
  item_id: string | null;
  item: { asset_code: string; label: string | null } | null;
  reporter: string | null;
  severity: ReportSeverity;
  description: string;
  status: ReportStatus;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  loan: { start_date: string; end_date: string; status: string } | null;
}

/** A tagged item that went out on a loan, as the borrower picks it. */
export interface LoanItemOption {
  id: string;
  asset_code: string;
  label: string | null;
}

export function isReportSeverity(value: unknown): value is ReportSeverity {
  return typeof value === "string" && (REPORT_SEVERITIES as readonly string[]).includes(value);
}

/** The condition a principal would most likely give an item after this report. */
export function suggestedCondition(severity: ReportSeverity): ItemCondition {
  return severity === "minor" ? "fair" : "needs_repair";
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export interface ReportableLoan {
  status: string;
  /** When the loan stopped being out (set when it leaves 'approved'). */
  loan_closed_at?: string | null;
  updated_at?: string | null;
}

/**
 * Whether the borrower can report a problem on this loan: while it's out, and
 * for REPORT_WINDOW_DAYS after it comes back (a tent's broken pole is found
 * when it's unpacked at home, or at the next trip). Pending, declined and
 * cancelled requests never had kit handed over.
 */
export function canReportOn(loan: ReportableLoan, now: Date = new Date(), windowDays = REPORT_WINDOW_DAYS): boolean {
  if (loan.status === "approved") return true;
  if (loan.status !== "returned") return false;
  const closed = Date.parse(loan.loan_closed_at ?? loan.updated_at ?? "");
  if (!Number.isFinite(closed)) return false;
  return now.getTime() - closed <= windowDays * 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReportInput {
  requestId: string;
  severity: ReportSeverity;
  description: string;
  itemId: string | null;
}

/** Read a new report from a request body. */
export function parseReportInput(raw: unknown): { ok: true; input: ReportInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Say what's wrong." };
  const body = raw as Record<string, unknown>;
  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  if (!UUID.test(requestId)) return { ok: false, error: "Choose the loan this is about." };
  if (!isReportSeverity(body.severity)) return { ok: false, error: "Say how bad it is: minor, needs repair or can't be used." };
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) return { ok: false, error: "Say what's wrong." };
  if (description.length > MAX_DESCRIPTION) {
    return { ok: false, error: `Keep it under ${MAX_DESCRIPTION} characters.` };
  }
  let itemId: string | null = null;
  if (body.itemId !== undefined && body.itemId !== null && body.itemId !== "") {
    itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
    if (!UUID.test(itemId)) return { ok: false, error: "That item isn't on this loan." };
  }
  return { ok: true, input: { requestId, severity: body.severity, description, itemId } };
}

export interface ResolveInput {
  note: string | null;
  /** Re-grade the named item as part of resolving; null leaves it alone. */
  condition: ItemCondition | null;
}

/** Read a resolution from a request body. Everything is optional. */
export function parseResolveInput(raw: unknown): { ok: true; input: ResolveInput } | { ok: false; error: string } {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
  if (note && note.length > MAX_RESOLUTION_NOTE) {
    return { ok: false, error: `Keep the note under ${MAX_RESOLUTION_NOTE} characters.` };
  }
  const condition = body.condition;
  if (condition !== undefined && condition !== null && condition !== "" && !isItemCondition(condition)) {
    return { ok: false, error: "Condition must be good, fair or needs_repair." };
  }
  return { ok: true, input: { note, condition: isItemCondition(condition) ? condition : null } };
}

/** The table isn't there yet: the migration hasn't run on this database. */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  const message = error.message ?? "";
  return message.includes("equipment_condition_reports") && /does not exist|schema cache/i.test(message);
}

/** The principals' notification for a new report. */
export function reportMessage(report: {
  severity: ReportSeverity;
  description: string;
  equipmentName: string;
  itemCode: string | null;
  reporter: string;
}): { title: string; body: string } {
  const what = report.itemCode ? `${report.equipmentName} ${report.itemCode}` : report.equipmentName;
  const body = report.description.length > 140 ? `${report.description.slice(0, 139)}…` : report.description;
  return {
    title: `${SEVERITY_LABELS[report.severity]}: ${what}`,
    body: `${report.reporter}: ${body}`,
  };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const REPORT_SELECT = `
  id, request_id, equipment_id, item_id, severity, description, status,
  resolved_at, resolution_note, created_at,
  equipment:equipment_id(name),
  item:item_id(asset_code, label),
  reporter:reporter_member_id(full_name),
  loan:request_id(start_date, end_date, status, borrower_name)
`;

interface ReportRow {
  id: string;
  request_id: string;
  equipment_id: string;
  item_id: string | null;
  severity: ReportSeverity;
  description: string;
  status: ReportStatus;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  equipment: { name: string } | null;
  item: { asset_code: string; label: string | null } | null;
  reporter: { full_name: string | null } | null;
  loan: { start_date: string; end_date: string; status: string; borrower_name: string | null } | null;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function toReport(row: ReportRow): ConditionReport {
  const loan = one(row.loan);
  const item = one(row.item);
  return {
    id: row.id,
    request_id: row.request_id,
    equipment_id: row.equipment_id,
    equipment_name: one(row.equipment)?.name ?? "Club kit",
    item_id: row.item_id,
    item: item ? { asset_code: item.asset_code, label: item.label } : null,
    reporter: one(row.reporter)?.full_name || loan?.borrower_name || null,
    severity: row.severity,
    description: row.description,
    status: row.status,
    resolved_at: row.resolved_at,
    resolution_note: row.resolution_note,
    created_at: row.created_at,
    loan: loan ? { start_date: loan.start_date, end_date: loan.end_date, status: loan.status } : null,
  };
}

export type ReportList = { ok: true; reports: ConditionReport[] } | { ok: false; missing: boolean; error: string };

/** Open reports (for principals), or one member's own recent ones. */
export async function listReports(
  supabase: SupabaseClient,
  scope: { open: true } | { reporterId: string },
): Promise<ReportList> {
  let query = supabase.from("equipment_condition_reports").select(REPORT_SELECT).order("created_at", { ascending: false });
  query = "open" in scope ? query.eq("status", "open") : query.eq("reporter_member_id", scope.reporterId).limit(50);
  const { data, error } = await query;
  if (error) return { ok: false, missing: isMissingTable(error), error: error.message };
  return { ok: true, reports: ((data ?? []) as unknown as ReportRow[]).map(toReport) };
}

export async function reportById(supabase: SupabaseClient, id: string): Promise<ConditionReport | null> {
  const { data } = await supabase.from("equipment_condition_reports").select(REPORT_SELECT).eq("id", id).maybeSingle();
  return data ? toReport(data as unknown as ReportRow) : null;
}

/**
 * The tagged items that went out on a loan: those still out on it, and those
 * scanned out against it and since checked back in (the check_out events).
 */
export async function loanItems(supabase: SupabaseClient, requestId: string): Promise<LoanItemOption[]> {
  const [{ data: out, error: outError }, { data: events, error: eventsError }] = await Promise.all([
    supabase.from("equipment_items").select("id").eq("loan_request_id", requestId),
    supabase.from("equipment_item_events").select("item_id").eq("request_id", requestId).eq("action", "check_out"),
  ]);
  if (outError || eventsError) throw new Error((outError ?? eventsError)!.message);
  const ids = [...new Set<string>([...(out ?? []).map((r) => r.id as string), ...(events ?? []).map((e) => e.item_id as string)])];
  if (!ids.length) return [];
  const { data, error } = await supabase.from("equipment_items").select("id, asset_code, label").in("id", ids).order("asset_code");
  if (error) throw new Error(error.message);
  return (data ?? []) as LoanItemOption[];
}
