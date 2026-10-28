import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { audit } from "@/lib/audit";
import { SheetsError } from "@/lib/googleSheets";
import { getCurrentMember } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase";
import { restoreLeaders } from "@/lib/walkSheetSync";

export const maxDuration = 120;

/**
 * Put the WL calendar's sign-ups back to how the leader history had them.
 *
 * Body: `{ as_of: "2026-10-26T14:30:00Z", from?: "2026-10-28", apply?: true }`.
 * Without `apply` it only returns the plan: the cells that would change.
 */
export async function POST(request: Request) {
  const member = await getCurrentMember();
  if (!member || !can(profileOf(member), "trigger_sync")) return NextResponse.json({ error: "Committee only." }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { as_of?: unknown; from?: unknown; apply?: unknown } | null;
  if (!body || typeof body.as_of !== "string" || Number.isNaN(Date.parse(body.as_of))) return NextResponse.json({ error: "as_of must be a date and time." }, { status: 400 });
  const from = typeof body.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.from) ? body.from : undefined;
  try {
    const result = await restoreLeaders(new Date(body.as_of).toISOString(), { from, apply: body.apply === true, editorId: member.id });
    if (body.apply === true) await audit(member.id, "rota.restore", "sheet_walks", "all", { as_of: body.as_of, walks: result.plan.length, written: result.written });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof SheetsError ? e.message : e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
