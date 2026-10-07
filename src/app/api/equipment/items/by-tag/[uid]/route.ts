import { lookupByTag, normalizeTagUid } from "@/lib/equipmentItems";
import { json, requireLender } from "../../lender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What a scanned tag is: `{ item, equipment, loan }`, or 404 `{ unregistered: true, uid }`. */
export async function GET(_request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const auth = await requireLender();
  if (!auth.ok) return auth.response;
  const { uid: raw } = await params;
  const uid = normalizeTagUid(decodeURIComponent(raw));
  if (!uid) return json({ error: "That doesn't look like an NFC tag ID." }, 400);
  try {
    const found = await lookupByTag(auth.supabase, uid);
    if (!found) return json({ unregistered: true, uid }, 404);
    return json(found);
  } catch (err) {
    console.error(`[equipment/items] tag lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    return json({ error: "Failed to look up the tag" }, 500);
  }
}
