import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { audit } from "@/lib/audit";
import { SheetsError } from "@/lib/googleSheets";
import { isRotaField, rotaCellText } from "@/lib/rota";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { editWalk, resolveConflict } from "@/lib/walkSheetSync";

export const maxDuration = 60;

/**
 * A walk leader writes names into a walk's WL calendar slots. Only the rota
 * cells (six walk leaders, additional leaders, shadowing) can be touched here;
 * everything goes straight to the sheet through editWalk, which turns an edit
 * the sheet has moved on from into a conflict instead of typing over it.
 *
 * Body: `{ walk_id, edits: { leader1: "Niha", … }, from: { leader1: "" } }`
 * or `{ walk_id, resolve: { field, keep: "sheet" | "app" } }`.
 */
export async function PUT(request: Request) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!can(profileOf(member), "lead_walks")) return NextResponse.json({ error: "Only walk leaders and committee use the rota." }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "The rota needs the database." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { walk_id?: unknown; edits?: unknown; from?: unknown; resolve?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Send it as JSON." }, { status: 400 });
  if (typeof body.walk_id !== "string" || !body.walk_id) return NextResponse.json({ error: "Which walk?" }, { status: 400 });

  const { data: walk } = await getSupabaseAdmin().from("sheet_walks").select("id, title").eq("id", body.walk_id).eq("present", true).maybeSingle();
  if (!walk) return NextResponse.json({ error: "That walk isn't on the WL calendar any more." }, { status: 404 });

  try {
    const resolve = body.resolve as { field?: unknown; keep?: unknown } | undefined;
    if (resolve) {
      if (!isRotaField(resolve.field) || (resolve.keep !== "sheet" && resolve.keep !== "app")) {
        return NextResponse.json({ error: "Keep which, for which name?" }, { status: 400 });
      }
      const result = await resolveConflict(walk.id, resolve.field, resolve.keep, member.id);
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
      await audit(member.id, "rota.resolve", "sheet_walks", walk.id, { title: walk.title, field: resolve.field, keep: resolve.keep });
      return NextResponse.json({ ok: true, written: result.written, conflicts: result.conflicts });
    }

    if (!body.edits || typeof body.edits !== "object") return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
    const edits: Record<string, string> = {};
    for (const [key, value] of Object.entries(body.edits as Record<string, unknown>)) {
      if (!isRotaField(key)) return NextResponse.json({ error: "Only the walk leader names can be changed here." }, { status: 400 });
      edits[key] = rotaCellText(key, value);
    }
    const from: Record<string, string> = {};
    if (body.from && typeof body.from === "object") {
      for (const [key, value] of Object.entries(body.from as Record<string, unknown>)) if (typeof value === "string") from[key] = value;
    }
    const result = await editWalk(walk.id, edits, from, member.id);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
    await audit(member.id, "rota.update", "sheet_walks", walk.id, { title: walk.title, written: result.written, conflicts: result.conflicts });
    return NextResponse.json({ ok: true, written: result.written, conflicts: result.conflicts });
  } catch (e) {
    return NextResponse.json({ error: e instanceof SheetsError ? e.message : "The WL calendar couldn't be updated. Try again." }, { status: 502 });
  }
}
