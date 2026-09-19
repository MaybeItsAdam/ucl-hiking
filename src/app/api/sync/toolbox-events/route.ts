import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { can } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { TOOLBOX_EVENT_SOURCE, toolboxEventRow, type ToolboxEventData } from "@/lib/toolboxEvents";

/**
 * Daily reconcile of the Events tab against Adam's Campus Toolbox.
 *
 * Webhooks are the live feed; this is the safety net they need. A webhook only
 * fires on a change, so it never delivers the events that existed before the
 * endpoint was registered, and Toolbox documents that a row deleted by hand in
 * its database reaches no subscriber. Reading the full list once a day fixes
 * both: it upserts everything and removes Toolbox-owned rows no longer listed.
 *
 * Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`; committee can
 * also run it by hand while signed in.
 */
function bearerMatches(header: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function authorised(request: Request): Promise<boolean> {
  if (bearerMatches(request.headers.get("authorization"))) return true;
  const member = await getCurrentMember();
  return Boolean(
    member &&
      can(
        { membershipTier: member.membership_tier, governanceRole: member.governance_role, isWalkLeader: member.is_walk_leader },
        "trigger_sync",
      ),
  );
}

export async function GET(request: Request) {
  if (!(await authorised(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.TOOLBOX_API_TOKEN;
  const organiserId = process.env.TOOLBOX_ORGANISER_ID;
  if (!token || !organiserId) {
    return NextResponse.json({ error: "TOOLBOX_API_TOKEN and TOOLBOX_ORGANISER_ID must be set" }, { status: 503 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const toolbox = (process.env.TOOLBOX_URL || "https://www.adamscampustoolbox.org.uk").replace(/\/$/, "");
  let events: ToolboxEventData[];
  try {
    const res = await fetch(`${toolbox}/api/v1/organisers/${encodeURIComponent(organiserId)}/events`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Toolbox events API returned ${res.status}` }, { status: 502 });
    }
    const body = (await res.json()) as { events?: unknown };
    if (!Array.isArray(body.events)) {
      return NextResponse.json({ error: "Toolbox events API returned no event list" }, { status: 502 });
    }
    events = body.events as ToolboxEventData[];
  } catch {
    return NextResponse.json({ error: "Toolbox events API is unavailable" }, { status: 502 });
  }

  const syncedAt = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  const listed = new Set<string>();
  let skipped = 0;
  for (const event of events) {
    const mapped = toolboxEventRow(event, syncedAt);
    if (mapped.ok) {
      rows.push(mapped.row);
      listed.add(mapped.id);
    } else {
      skipped += 1;
    }
  }

  const supabase = getSupabaseAdmin();
  if (rows.length) {
    const { error } = await supabase.from("events").upsert(rows, { onConflict: "suu_event_id" });
    if (error) return NextResponse.json({ error: `Database error: ${error.message}` }, { status: 500 });
  }

  // Never prune from an empty list: that is far likelier to be a Toolbox fault
  // than the club genuinely having no events at all.
  let removed = 0;
  if (listed.size) {
    const { data: owned, error } = await supabase
      .from("events")
      .select("suu_event_id")
      .eq("source", TOOLBOX_EVENT_SOURCE);
    if (error) return NextResponse.json({ error: `Database error: ${error.message}` }, { status: 500 });
    const gone = (owned ?? []).map((row) => row.suu_event_id as string).filter((id) => id && !listed.has(id));
    if (gone.length) {
      const { error: deleteError } = await supabase.from("events").delete().in("suu_event_id", gone);
      if (deleteError) return NextResponse.json({ error: `Database error: ${deleteError.message}` }, { status: 500 });
      removed = gone.length;
    }
  }

  return NextResponse.json({ ok: true, upserted: rows.length, skipped, removed });
}
