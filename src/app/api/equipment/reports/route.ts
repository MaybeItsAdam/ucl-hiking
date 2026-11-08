import { can, profileOf } from "@/lib/access";
import { audit } from "@/lib/audit";
import {
  MAX_OPEN_PER_REQUEST,
  REPORT_WINDOW_DAYS,
  REPORTS_UNAVAILABLE,
  canReportOn,
  isMissingTable,
  listReports,
  loanItems,
  parseReportInput,
  reportById,
  reportMessage,
} from "@/lib/kitReports";
import { notify } from "@/lib/notify";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { json, readJson } from "../items/lender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Kit problem reports. Principals get every open one; anyone else gets the
 * ones they made. Before the migration has run this is an empty list with
 * `available: false`, never an error, so the Equipment page still loads.
 */
export async function GET() {
  const member = await getCurrentMember();
  if (!member) return json({ error: "Unauthorized" }, 401);
  if (!isSupabaseConfigured()) return json({ reports: [], available: false });

  const isLender = can(profileOf(member), "review_equipment_requests");
  const result = await listReports(getSupabaseAdmin(), isLender ? { open: true } : { reporterId: member.id });
  if (!result.ok) {
    if (result.missing) return json({ reports: [], available: false });
    console.error(`[equipment/reports] list failed: ${result.error}`);
    return json({ error: "Couldn't load problem reports" }, 500);
  }
  return json({ reports: result.reports, available: true });
}

/** A borrower reports a problem with kit on one of their own loans. */
export async function POST(request: Request) {
  const member = await getCurrentMember();
  if (!member) return json({ error: "Unauthorized" }, 401);
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const parsed = parseReportInput(read.body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { input } = parsed;

  if (!isSupabaseConfigured()) return json({ error: REPORTS_UNAVAILABLE }, 503);
  const supabase = getSupabaseAdmin();

  const { data: loan } = await supabase
    .from("equipment_requests")
    .select("id, member_id, status, equipment_id, loan_closed_at, updated_at, equipment:equipment_id(name)")
    .eq("id", input.requestId)
    .maybeSingle();
  // Someone else's loan reads the same as no loan.
  if (!loan || loan.member_id !== member.id) return json({ error: "That loan wasn't found." }, 404);
  if (!canReportOn(loan)) {
    return json(
      { error: `You can report a problem while kit is out, and for ${REPORT_WINDOW_DAYS} days after it's back. Tell a principal directly.` },
      409,
    );
  }

  let itemCode: string | null = null;
  if (input.itemId) {
    try {
      const items = await loanItems(supabase, loan.id);
      const item = items.find((i) => i.id === input.itemId);
      if (!item) return json({ error: "That item wasn't on this loan." }, 400);
      itemCode = item.asset_code;
    } catch (err) {
      console.error(`[equipment/reports] loan items for ${loan.id}: ${err instanceof Error ? err.message : String(err)}`);
      return json({ error: "Couldn't check the items on this loan. Try again, or leave the item blank." }, 500);
    }
  }

  const { count, error: countError } = await supabase
    .from("equipment_condition_reports")
    .select("id", { count: "exact", head: true })
    .eq("request_id", loan.id)
    .eq("status", "open");
  if (countError) {
    if (isMissingTable(countError)) return json({ error: REPORTS_UNAVAILABLE }, 503);
    console.error(`[equipment/reports] count failed: ${countError.message}`);
    return json({ error: "Couldn't send the report. Try again." }, 500);
  }
  if ((count ?? 0) >= MAX_OPEN_PER_REQUEST) {
    return json({ error: "This loan already has several open reports. A principal will be in touch." }, 409);
  }

  const { data: created, error } = await supabase
    .from("equipment_condition_reports")
    .insert({
      request_id: loan.id,
      equipment_id: loan.equipment_id,
      item_id: input.itemId,
      reporter_member_id: member.id,
      severity: input.severity,
      description: input.description,
    })
    .select("id")
    .single();
  if (error || !created) {
    if (isMissingTable(error)) return json({ error: REPORTS_UNAVAILABLE }, 503);
    console.error(`[equipment/reports] insert failed: ${error?.message}`);
    return json({ error: "Couldn't send the report. Try again." }, 500);
  }

  await audit(member.id, "equipment_report.create", "equipment_condition_reports", created.id, {
    request_id: loan.id,
    item_id: input.itemId,
    severity: input.severity,
  });

  const equipmentName = (Array.isArray(loan.equipment) ? loan.equipment[0] : loan.equipment)?.name ?? "Club kit";
  await tellPrincipals(member.id, {
    ...reportMessage({
      severity: input.severity,
      description: input.description,
      equipmentName,
      itemCode,
      reporter: member.full_name || "A member",
    }),
  });

  const report = await reportById(supabase, created.id);
  return json({ ok: true, report }, 201);
}

/** Best effort: a report is saved whether or not the principals are pinged. */
async function tellPrincipals(reporterId: string, message: { title: string; body: string }) {
  try {
    const { data: principals, error } = await getSupabaseAdmin()
      .from("members")
      .select("id")
      .in("governance_role", ["principal", "admin"])
      .is("revoked_at", null)
      .neq("id", reporterId);
    if (error) throw new Error(error.message);
    const ids = (principals ?? []).map((p) => p.id as string);
    if (ids.length) await notify(ids, { kind: "kit", ...message, url: "/portal/equipment" });
  } catch (err) {
    console.error(`[equipment/reports] principals not notified: ${err instanceof Error ? err.message : String(err)}`);
  }
}
