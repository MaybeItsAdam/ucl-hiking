import { can, profileOf } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";
import { json, requireLender } from "../lender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
