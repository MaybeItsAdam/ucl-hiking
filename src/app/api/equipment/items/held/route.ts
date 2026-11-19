import { listHeldItems, toPublicView } from "@/lib/equipmentItems";
import { json, requireMember } from "../lender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The tagged kit in your hands now: your own loans' items and anything passed to you. */
export async function GET() {
  const auth = await requireMember();
  if (!auth.ok) return auth.response;
  try {
    const items = await listHeldItems(auth.supabase, auth.member.id);
    const viewer = { id: auth.member.id, role: auth.member.governance_role };
    return json({ items: items.map((item) => ({ ...toPublicView(item, viewer).item, loan: item.loan })) });
  } catch (err) {
    console.warn(`[equipment/items/held] ${err instanceof Error ? err.message : String(err)}`);
    return json({ items: [] });
  }
}
