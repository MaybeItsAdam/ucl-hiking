import { applyBatchOp, MAX_BATCH_OPS, type BatchOpResult } from "@/lib/equipmentItems";
import { json, readJson, requireLender } from "../lender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The phone's offline queue. Ops are applied in order; each is idempotent on its
 * clientId, and one that fails never stops the rest.
 */
export async function POST(request: Request) {
  const auth = await requireLender();
  if (!auth.ok) return auth.response;
  const read = await readJson(request);
  if (!read.ok) return read.response;

  const ops = (read.body as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(ops)) return json({ error: "Send { ops: [...] }." }, 400);
  if (ops.length > MAX_BATCH_OPS) {
    return json({ error: `Send at most ${MAX_BATCH_OPS} scans at a time.` }, 413);
  }

  const results: BatchOpResult[] = [];
  const now = new Date();
  for (const op of ops) {
    try {
      results.push(await applyBatchOp(auth.supabase, op, auth.memberId, now));
    } catch (err) {
      const clientId = op && typeof op === "object" && typeof (op as { clientId?: unknown }).clientId === "string"
        ? (op as { clientId: string }).clientId
        : null;
      console.error(`[equipment/items/batch] op ${clientId ?? "?"} failed: ${err instanceof Error ? err.message : String(err)}`);
      results.push({ clientId, ok: false, error: "Couldn't save this scan. It will be retried." });
    }
  }
  return json({ results });
}
