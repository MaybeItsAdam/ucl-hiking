import { audit } from "@/lib/audit";
import { applyItemAction, type ItemSummary } from "@/lib/equipmentItems";
import { MAX_RESOLUTION_NOTE, REPORTS_UNAVAILABLE, isMissingTable, parseResolveInput, reportById } from "@/lib/kitReports";
import { json, readJson, requireLender } from "../../items/lender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A lender resolves a report, with an optional note. With `condition`, the
 * item the report names is re-graded through its flag action first, so the
 * change is in the item's own log like any other flag.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireLender();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const parsed = parseResolveInput(read.body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { note, condition } = parsed.input;
  const { supabase, memberId } = auth;

  const { data: row, error: readError } = await supabase
    .from("equipment_condition_reports")
    .select("id, status, item_id, description")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    if (isMissingTable(readError)) return json({ error: REPORTS_UNAVAILABLE }, 503);
    // A malformed id is a bad uuid to Postgres; it's still "not found" to the lender.
    if (readError.code !== "22P02") console.error(`[equipment/reports] read ${id}: ${readError.message}`);
    return json({ error: "That report wasn't found." }, 404);
  }
  if (!row) return json({ error: "That report wasn't found." }, 404);
  if (row.status !== "open") return json({ error: "That report has already been resolved." }, 409);

  let item: ItemSummary | undefined;
  if (condition) {
    if (!row.item_id) return json({ error: "This report doesn't name a tagged item, so there's nothing to re-grade." }, 400);
    const flagNote = (note ?? `Reported: ${row.description}`).slice(0, MAX_RESOLUTION_NOTE);
    // Keyed on the report, so a retry after a failed save below doesn't flag twice.
    const result = await applyItemAction(
      supabase,
      row.item_id,
      { action: "flag", condition, notes: flagNote },
      { actorId: memberId, clientId: `report-${row.id}`, at: new Date().toISOString() },
    );
    if (!result.ok) return json({ error: result.error }, result.status);
    item = result.item;
  }

  const { data: updated, error } = await supabase
    .from("equipment_condition_reports")
    .update({ status: "resolved", resolved_by_member_id: memberId, resolved_at: new Date().toISOString(), resolution_note: note })
    .eq("id", row.id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error(`[equipment/reports] resolve ${row.id}: ${error.message}`);
    return json({ error: "Couldn't resolve the report. Try again." }, 500);
  }
  if (!updated) return json({ error: "That report was resolved by someone else just now." }, 409);

  await audit(memberId, "equipment_report.resolve", "equipment_condition_reports", row.id, {
    item_id: row.item_id,
    condition,
  });

  return json({ ok: true, report: await reportById(supabase, row.id), item });
}
