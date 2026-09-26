import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import type { SUEvent } from "@/lib/types";

// `*`, not a column list, throughout: local dev reads the production database,
// which may not have this deploy's columns yet.

async function devEvents(): Promise<SUEvent[]> {
  if (process.env.NODE_ENV === "production") return [];
  const { getDevEvents } = await import("@/lib/dev-store");
  return getDevEvents() as SUEvent[];
}

/** Upcoming events, plus any that started earlier but are still running (a weekend away). */
export async function getUpcomingEvents(): Promise<SUEvent[]> {
  if (!isSupabaseConfigured()) return devEvents();
  const now = new Date().toISOString();
  const { data } = await getSupabaseAdmin()
    .from("events")
    .select("*")
    .or(`starts_at.gte.${now},ends_at.gte.${now}`)
    .neq("status", "draft")
    .order("starts_at", { ascending: true })
    .limit(200);
  return (data ?? []) as SUEvent[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getEvent(id: string): Promise<SUEvent | null> {
  if (!isSupabaseConfigured()) return (await devEvents()).find((e) => e.id === id) ?? null;
  // Anything else would reach Postgres as a uuid cast error rather than a miss.
  if (!UUID.test(id)) return null;
  const { data } = await getSupabaseAdmin().from("events").select("*").eq("id", id).neq("status", "draft").maybeSingle();
  return (data as SUEvent | null) ?? null;
}

/**
 * Every event in a club year, September to August — the year the committee,
 * the freshers and the walk programme all run by. `year` is the one it starts in.
 */
export async function getEventsInClubYear(year: number): Promise<SUEvent[]> {
  // 1 September is always summer time in London, so its midnight is 23:00 UTC the day before.
  const from = `${year}-08-31T23:00:00Z`;
  const to = `${year + 1}-08-31T23:00:00Z`;
  if (!isSupabaseConfigured()) {
    return (await devEvents()).filter((e) => e.starts_at && e.starts_at >= from && e.starts_at < to);
  }
  const { data } = await getSupabaseAdmin()
    .from("events")
    .select("*")
    .gte("starts_at", from)
    .lt("starts_at", to)
    .neq("status", "draft")
    .order("starts_at", { ascending: true })
    .limit(1000);
  return (data ?? []) as SUEvent[];
}

/** Events by their SU ids, oldest first; for a member's walk history. */
export async function getEventsBySuuIds(ids: string[]): Promise<SUEvent[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  if (!isSupabaseConfigured()) return (await devEvents()).filter((e) => e.suu_event_id && unique.includes(e.suu_event_id));
  const { data } = await getSupabaseAdmin()
    .from("events")
    .select("*")
    .in("suu_event_id", unique)
    .neq("status", "draft")
    .order("starts_at", { ascending: true });
  return (data ?? []) as SUEvent[];
}
