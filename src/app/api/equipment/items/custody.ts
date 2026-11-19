import type { SupabaseClient } from "@supabase/supabase-js";
import { itemName, type ActionResult } from "@/lib/equipmentItems";
import { notify } from "@/lib/notify";

/**
 * Tell the people a change of hands concerns, other than whoever did it: the
 * person it left, the person it went to, and the borrower whose loan it's on.
 * Check-outs at a pickup and check-ins aren't announced: both people were there.
 */
export async function tellCustodyChange(
  supabase: SupabaseClient,
  result: Extract<ActionResult, { ok: true }>,
  action: string,
  actorId: string,
): Promise<void> {
  const custody = result.custody;
  if (!custody || result.duplicate || result.noop) return;
  if (action !== "transfer" && action !== "hand_out") return;
  const what = `${result.item.equipment_name} ${itemName(result.item)}`;
  const to = result.item.holder?.name ?? "another member";

  let borrowerId: string | null = null;
  if (custody.requestId) {
    const { data } = await supabase.from("equipment_requests").select("member_id").eq("id", custody.requestId).maybeSingle();
    borrowerId = (data?.member_id as string | null) ?? null;
  }

  try {
    if (custody.toMemberId && custody.toMemberId !== actorId) {
      await notify([custody.toMemberId], {
        kind: "kit",
        title: `You have ${what}`,
        body:
          action === "hand_out"
            ? "A committee member checked it out to you. Give it back to the committee when you're done."
            : "It was passed to you. Pass it on by having the next person scan it, or give it back to the committee.",
        url: "/portal/equipment",
      });
    }
    const others = [custody.fromMemberId, borrowerId].filter(
      (id): id is string => Boolean(id) && id !== actorId && id !== custody.toMemberId,
    );
    if (others.length) {
      await notify([...new Set(others)], {
        kind: "kit",
        title: `${to} has ${what}`,
        body: "It's no longer down as being with you.",
        url: "/portal/equipment",
      });
    }
  } catch (err) {
    console.warn(`[equipment/custody] notify failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
