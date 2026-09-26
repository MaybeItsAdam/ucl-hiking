import { eventDetails } from "@/lib/eventDetails";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import type { SUEvent } from "@/lib/types";

export const AVAILABILITY = ["available", "maybe", "unavailable"] as const;
export type Availability = (typeof AVAILABILITY)[number];

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  available: "Can lead",
  maybe: "Maybe",
  unavailable: "Can't",
};

export interface AvailabilityRow {
  event_suu_id: string;
  member_id: string;
  status: Availability;
  member?: { full_name: string | null } | null;
}

export function isAvailability(value: unknown): value is Availability {
  return typeof value === "string" && AVAILABILITY.includes(value as Availability);
}

/** Walks, not socials: the rota is for events someone has to lead on a hill. */
export function needsLeader(event: SUEvent): boolean {
  if (!event.suu_event_id || event.status === "cancelled") return false;
  const kind = eventDetails(event).kind;
  return kind === "hike" || kind === "walk" || kind === "trip";
}

/** Walks in the next `days` days that need a leader, soonest first. */
export function rotaWalks(events: SUEvent[], days = 60, now = new Date()): SUEvent[] {
  const until = now.getTime() + days * 24 * 60 * 60 * 1000;
  return events.filter((e) => needsLeader(e) && e.starts_at && new Date(e.starts_at).getTime() < until);
}

/** Availability for many walks, grouped by SU id. A missing table reads as none. */
export async function getAvailability(eventSuuIds: string[]): Promise<Map<string, AvailabilityRow[]>> {
  const out = new Map<string, AvailabilityRow[]>();
  if (!eventSuuIds.length || !isSupabaseConfigured()) return out;
  const { data, error } = await getSupabaseAdmin()
    .from("leader_availability")
    .select("event_suu_id, member_id, status, member:member_id (full_name)")
    .in("event_suu_id", eventSuuIds);
  if (error) return out;
  for (const row of (data ?? []) as unknown as AvailabilityRow[]) {
    const list = out.get(row.event_suu_id) ?? [];
    list.push(row);
    out.set(row.event_suu_id, list);
  }
  return out;
}
