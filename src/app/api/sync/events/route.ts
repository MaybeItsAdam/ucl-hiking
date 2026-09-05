import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { getCurrentMember } from "@/lib/session";
import { can } from "@/lib/access";

interface SyncEvent {
  suuEventId?: unknown;
  title?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  location?: unknown;
  status?: unknown;
  capacity?: unknown;
  ticketsSold?: unknown;
  pricePence?: unknown;
  sourceReference?: unknown;
}

function secretMatches(provided: string | null): boolean {
  const expected = process.env.MEMBER_SYNC_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const secretProvided = request.headers.get("x-member-sync-secret");
  const isSecretValid = secretMatches(secretProvided);

  if (!isSecretValid) {
    const member = await getCurrentMember();
    if (!member || !can({ membershipTier: member.membership_tier, governanceRole: member.governance_role, isWalkLeader: member.is_walk_leader }, "trigger_sync")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Database service is not configured" }, { status: 503 });
  }

  let payload: { source?: unknown; events?: SyncEvent[] };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(payload.events)) {
    return NextResponse.json({ error: "events must be an array" }, { status: 400 });
  }

  const source = typeof payload.source === "string" ? payload.source.slice(0, 100) : "suu-cloud-run";
  const now = new Date().toISOString();
  const rows = payload.events.map((row) => ({
    suu_event_id: typeof row.suuEventId === "string" ? row.suuEventId.trim() : null,
    title: typeof row.title === "string" ? row.title.trim() : "Untitled Event",
    starts_at: typeof row.startsAt === "string" ? row.startsAt : null,
    ends_at: typeof row.endsAt === "string" ? row.endsAt : null,
    location: typeof row.location === "string" ? row.location.trim() : null,
    status: ["upcoming", "sold_out", "cancelled", "completed", "draft"].includes(String(row.status))
      ? String(row.status)
      : "upcoming",
    capacity: typeof row.capacity === "number" && row.capacity >= 0 ? Math.floor(row.capacity) : 0,
    tickets_sold: typeof row.ticketsSold === "number" && row.ticketsSold >= 0 ? Math.floor(row.ticketsSold) : 0,
    price_pence: typeof row.pricePence === "number" && row.pricePence >= 0 ? Math.floor(row.pricePence) : 0,
    source_reference: typeof row.sourceReference === "string" ? row.sourceReference : null,
    synced_at: now,
  }));

  const supabase = getSupabaseAdmin();
  const startedAt = new Date().toISOString();

  let upsertedCount = 0;
  if (rows.length > 0) {
    const { error } = await supabase.from("events").upsert(rows, { onConflict: "suu_event_id" });
    if (error) {
      await supabase.from("event_sync_runs").insert({
        source,
        received_count: rows.length,
        upserted_count: 0,
        status: "error",
        error_message: error.message,
        started_at: startedAt,
      });
      return NextResponse.json({ error: "Event sync failed: " + error.message }, { status: 500 });
    }
    upsertedCount = rows.length;
  }

  await supabase.from("event_sync_runs").insert({
    source,
    received_count: rows.length,
    upserted_count: upsertedCount,
    status: "success",
    started_at: startedAt,
  });

  return NextResponse.json({ ok: true, upserted: upsertedCount, syncedAt: now });
}
