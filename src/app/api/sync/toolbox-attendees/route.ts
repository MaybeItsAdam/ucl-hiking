import { NextResponse } from "next/server";
import { syncEventAttendees } from "@/lib/attendees";
import { cronOrCommittee } from "@/lib/cronAuth";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/** Walks from yesterday to two weeks out: late bookings, and the day after for refunds. */
const BEHIND_MS = 24 * 60 * 60 * 1000;
const AHEAD_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Pull SU ticket holders for upcoming events from Toolbox into
 * event_attendees. Until Toolbox serves the attendee endpoint this records
 * "unavailable" and changes nothing; leaders add people on the day instead.
 */
export async function GET(request: Request) {
  if (!(await cronOrCommittee(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const supabase = getSupabaseAdmin();
  const startedAt = new Date().toISOString();
  const { data: events, error } = await supabase
    .from("events")
    .select("suu_event_id")
    .gte("starts_at", new Date(Date.now() - BEHIND_MS).toISOString())
    .lte("starts_at", new Date(Date.now() + AHEAD_MS).toISOString())
    .not("suu_event_id", "is", null)
    .neq("status", "cancelled");
  if (error) return NextResponse.json({ error: "Couldn't read events" }, { status: 500 });

  const results = [];
  for (const { suu_event_id } of events ?? []) {
    const result = await syncEventAttendees(suu_event_id as string);
    results.push({ event: suu_event_id, ...result });
    // The endpoint isn't there at all: no point asking for every other event.
    if (result.status === "unavailable") break;
  }

  const unavailable = results.find((r) => r.status === "unavailable");
  const failed = results.filter((r) => r.status === "error");
  const upserted = results.reduce((n, r) => n + r.inserted + r.updated, 0);
  await supabase.from("event_sync_runs").insert({
    source: "toolbox-attendees",
    received_count: results.length,
    upserted_count: upserted,
    status: unavailable ? "unavailable" : failed.length ? "error" : "success",
    error_message: unavailable?.reason ?? (failed.length ? failed.map((f) => `${f.event}: ${"reason" in f ? f.reason : ""}`).join("; ") : null),
    started_at: startedAt,
  });

  return NextResponse.json({ ok: !failed.length, events: results.length, unavailable: Boolean(unavailable), results });
}
