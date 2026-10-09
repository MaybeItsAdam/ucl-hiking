import { eventDetails } from "@/lib/eventDetails";
import type { SUEvent } from "@/lib/types";

/**
 * The rota is the WL calendar's sign-up columns ("Walk/Hike Calendar" tab):
 * six single-name walk leader slots, then two cells that take any number of
 * names. Keys are the sheet fields in walkSheet.ts, so an edit here goes
 * straight back to the same cell through editWalk.
 */
export const ROTA_SLOTS = ["leader1", "leader2", "leader3", "leader4", "leader5", "leader6"] as const;
export const ROTA_LISTS = ["extraLeaders", "shadowing"] as const;
export const ROTA_FIELDS = [...ROTA_SLOTS, ...ROTA_LISTS] as const;
export type RotaField = (typeof ROTA_FIELDS)[number];

export const ROTA_LABELS: Record<RotaField, string> = {
  leader1: "Primary WL",
  leader2: "WL 2",
  leader3: "WL 3",
  leader4: "WL 4",
  leader5: "WL 5",
  leader6: "WL 6",
  extraLeaders: "Additional walk leaders",
  shadowing: "Shadowing WLs",
};

export function isRotaField(value: unknown): value is RotaField {
  return typeof value === "string" && (ROTA_FIELDS as readonly string[]).includes(value);
}

/**
 * What goes in the cell. A slot holds one name on one line; a list is typed
 * one name per line (or with commas) and stored the sheet's way, "A, B, C".
 */
export function rotaCellText(field: RotaField, raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  if ((ROTA_LISTS as readonly string[]).includes(field)) {
    return text
      .split(/\n/)
      .map((line) => line.replace(/\s+/g, " ").trim().replace(/^,+|,+$/g, "").trim())
      .filter(Boolean)
      .join(", ");
  }
  return text.replace(/\s+/g, " ").trim();
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
