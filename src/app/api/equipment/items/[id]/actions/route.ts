import { applyItemAction, clampAt, cleanClientId, parseActionInput } from "@/lib/equipmentItems";
import { tellCustodyChange } from "../../custody";
import { json, readJson, requireKitHandler } from "../../lender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * check_out / hand_out / transfer / check_in / audit / flag one item. Kit
 * handlers only: anyone else confirms a handover to themselves through
 * ../claim.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireKitHandler();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const read = await readJson(request);
  if (!read.ok) return read.response;

  const parsed = parseActionInput(read.body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const body = read.body as Record<string, unknown>;

  const result = await applyItemAction(auth.supabase, id, parsed.input, {
    actorId: auth.memberId,
    clientId: cleanClientId(body.clientId),
    at: clampAt(body.at),
  });
  if (!result.ok) return json({ error: result.error }, result.status);
  await tellCustodyChange(auth.supabase, result, parsed.input.action, auth.memberId);
  return json(result);
}
