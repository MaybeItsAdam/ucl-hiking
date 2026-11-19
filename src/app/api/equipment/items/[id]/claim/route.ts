import { applyItemAction, clampAt, cleanClientId, lookupById, toPublicView } from "@/lib/equipmentItems";
import { canRecordHandover } from "@/lib/kitCustody";
import { tellCustodyChange } from "../../custody";
import { json, readJson, requireMember } from "../../lender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "I've got this now": a member who has been handed an item that's out with
 * someone else scans it and confirms. Holding the tag is the proof, so the
 * receiver confirms rather than the giver, and nobody can be handed kit
 * without knowing. Recorded as a 'handover' event from the last holder to
 * them; the loan stays the original borrower's, and both hear about it.
 * Restricted kit only for the roles it's restricted to.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMember();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const body = (read.body ?? {}) as Record<string, unknown>;

  const found = await lookupById(auth.supabase, id).catch(() => null);
  if (!found) return json({ error: "That item isn't registered." }, 404);
  const allowed = canRecordHandover(
    { status: found.item.status, holder_member_id: found.item.holder?.id ?? null },
    { id: auth.member.id, handlesKit: false },
    auth.member.id,
  );
  if (!allowed.ok) return json({ error: allowed.error }, allowed.status);

  const result = await applyItemAction(
    auth.supabase,
    found.item.id,
    { action: "transfer", toMemberId: auth.member.id, notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 500) || undefined : undefined },
    { actorId: auth.member.id, clientId: cleanClientId(body.clientId), at: clampAt(body.at) },
  );
  if (!result.ok) return json({ error: result.error }, result.status);
  await tellCustodyChange(auth.supabase, result, "transfer", auth.member.id);
  return json({ ok: true, ...toPublicView(result.item, { id: auth.member.id, role: auth.member.governance_role }), message: result.message });
}
