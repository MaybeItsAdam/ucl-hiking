import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { audit } from "@/lib/audit";
import { SheetsError } from "@/lib/googleSheets";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { isVisibility } from "@/lib/walkSheet";
import { editWalk, resolveConflict, type StoredWalk } from "@/lib/walkSheetSync";

/**
 * The committee's say over one calendar row:
 * - `published`, `visibility`: the app's own, stored here;
 * - `eventSuuId`: which SU event it is (null unlinks; "auto" goes back to matching);
 * - `edits` (+ `from`, what the editor saw): written to the sheet;
 * - `resolve: { field, keep: "sheet" | "app" }`: settle a conflict.
 */
type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const member = await getCurrentMember();
  if (!member || !can(profileOf(member), "manage_walks")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Send JSON." }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase.from("sheet_walks").select("*").eq("id", id).maybeSingle();
  if (!existing) return NextResponse.json({ error: "No such walk." }, { status: 404 });
  const patch: Partial<StoredWalk> = {};

  if (typeof body.published === "boolean") {
    patch.published = body.published;
    patch.published_source = "app";
  }
  if (body.visibility !== undefined) {
    if (body.visibility === "sheet") patch.visibility_source = "sheet";
    else if (isVisibility(body.visibility)) {
      patch.visibility = body.visibility;
      patch.visibility_source = "app";
    } else return NextResponse.json({ error: "That isn't a visibility." }, { status: 400 });
  }
  if (body.eventSuuId !== undefined) {
    if (body.eventSuuId === null) {
      patch.event_suu_id = null;
      patch.link_source = "manual";
    } else if (body.eventSuuId === "auto") {
      patch.link_source = null;
    } else if (typeof body.eventSuuId === "string") {
      const { data: event } = await supabase.from("events").select("suu_event_id").eq("suu_event_id", body.eventSuuId).maybeSingle();
      if (!event) return NextResponse.json({ error: "No such SU event." }, { status: 400 });
      // One calendar row per SU event: take it off any other row first.
      await supabase.from("sheet_walks").update({ event_suu_id: null, link_source: "manual" }).eq("event_suu_id", body.eventSuuId).neq("id", id);
      patch.event_suu_id = body.eventSuuId;
      patch.link_source = "manual";
    }
  }

  let walk = existing as StoredWalk;
  if (Object.keys(patch).length) {
    const { data, error } = await supabase.from("sheet_walks").update(patch).eq("id", id).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    walk = data as StoredWalk;
  }

  let written: string[] = [];
  let conflicts: string[] = [];
  try {
    if (body.edits && typeof body.edits === "object") {
      const from = (body.from && typeof body.from === "object" ? body.from : {}) as Record<string, string>;
      const result = await editWalk(id, body.edits as Record<string, unknown>, from, member.id);
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
      ({ walk, written, conflicts } = result);
    }
    const resolve = body.resolve as { field?: unknown; keep?: unknown } | undefined;
    if (resolve && typeof resolve.field === "string" && (resolve.keep === "sheet" || resolve.keep === "app")) {
      const result = await resolveConflict(id, resolve.field, resolve.keep, member.id);
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
      ({ walk } = result);
      written = result.written;
      conflicts = result.conflicts;
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof SheetsError ? e.message : "The sheet couldn't be updated. Try again." }, { status: 502 });
  }

  await audit(member.id, "walk_sheet.update", "sheet_walks", id, { title: walk.title, ...patch, written, conflicts });

  return NextResponse.json({ ok: true, walk, written, conflicts });
}
