import { can, profileOf } from "@/lib/access";
import { lookupById, toPublicView } from "@/lib/equipmentItems";
import { getCurrentMember } from "@/lib/session";
import { json, requireLender, requireMember } from "../lender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One item by id, as the tag lookup gives it: the full view for kit handlers, the public one for anyone else. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMember();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const found = await lookupById(auth.supabase, id);
    if (!found) return json({ error: "That item isn't registered." }, 404);
    if (auth.handlesKit) return json(found);
    return json(toPublicView(found.item, { id: auth.member.id, role: auth.member.governance_role }));
  } catch (err) {
    console.error(`[equipment/items] lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    return json({ error: "Failed to look up the item" }, 500);
  }
}

/**
 * Delete a tagged item, which also frees its tag to be tagged again. For a
 * test tag, a sticker put on the wrong thing, or kit that's gone for good.
 * Its history goes with it (equipment_item_events cascades).
 *
 * Principals only (`manage_equipment`), not every lender: it can't be undone.
 * Refused while the item is out on loan, so a loan never loses track of kit.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireLender();
  if (!auth.ok) return auth.response;
  const member = await getCurrentMember();
  if (!member || !can(profileOf(member), "manage_equipment")) {
    return json({ error: "Only kit principals can delete tagged items." }, 403);
  }
  const { id } = await params;

  const { data: item, error: readError } = await auth.supabase
    .from("equipment_items")
    .select("id, asset_code, status")
    .eq("id", id)
    .maybeSingle();
  if (readError) return json({ error: "Couldn't delete the item. Try again." }, 500);
  if (!item) return json({ error: "That item has already been deleted." }, 404);
  if (item.status === "on_loan") {
    return json({ error: `${item.asset_code} is out on loan. Check it in before deleting it.` }, 409);
  }

  // The status check again in the delete itself, so a handover that lands in
  // between isn't silently undone.
  const { data: deleted, error } = await auth.supabase
    .from("equipment_items")
    .delete()
    .eq("id", id)
    .neq("status", "on_loan")
    .select("id");
  if (error) return json({ error: "Couldn't delete the item. Try again." }, 500);
  if (!deleted?.length) {
    return json({ error: `${item.asset_code} was handed over just now. Check it in before deleting it.` }, 409);
  }
  return json({ ok: true, id });
}
