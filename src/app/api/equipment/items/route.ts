import { clampAt, cleanClientId, commissionItem, listItemSummaries, parseCommissionInput } from "@/lib/equipmentItems";
import { json, readJson, requireLender } from "./lender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every tagged item, for the phone's offline lookup cache. */
export async function GET() {
  const auth = await requireLender();
  if (!auth.ok) return auth.response;
  try {
    const items = await listItemSummaries(auth.supabase);
    return json({ items, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error(`[equipment/items] list failed: ${err instanceof Error ? err.message : String(err)}`);
    return json({ error: "Failed to fetch kit items" }, 500);
  }
}

/** Tag (commission) a new item. */
export async function POST(request: Request) {
  const auth = await requireLender();
  if (!auth.ok) return auth.response;
  const read = await readJson(request);
  if (!read.ok) return read.response;

  const parsed = parseCommissionInput(read.body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const body = read.body as Record<string, unknown>;

  const result = await commissionItem(auth.supabase, parsed.input, {
    actorId: auth.memberId,
    clientId: cleanClientId(body.clientId),
    at: clampAt(body.at),
  });
  if (!result.ok) return json({ error: result.error }, result.status);
  return json(result, result.duplicate ? 200 : 201);
}
