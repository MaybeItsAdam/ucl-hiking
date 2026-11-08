import { can, profileOf } from "@/lib/access";
import { loanItems } from "@/lib/kitReports";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { json } from "../../../items/lender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The tagged items that went out on a loan, including any already back, so a
 * borrower can say which one a problem is with. For the borrower and lenders.
 * Untagged kit, or no items table yet, is an empty list.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember();
  if (!member) return json({ error: "Unauthorized" }, 401);
  const { id } = await params;
  if (!isSupabaseConfigured()) return json({ items: [] });
  const supabase = getSupabaseAdmin();

  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "That loan wasn't found." }, 404);
  const { data: loan } = await supabase.from("equipment_requests").select("member_id").eq("id", id).maybeSingle();
  const allowed = loan && (loan.member_id === member.id || can(profileOf(member), "review_equipment_requests"));
  if (!allowed) return json({ error: "That loan wasn't found." }, 404);

  try {
    return json({ items: await loanItems(supabase, id) });
  } catch (err) {
    console.warn(`[equipment/requests/items] ${id}: ${err instanceof Error ? err.message : String(err)}`);
    return json({ items: [] });
  }
}
