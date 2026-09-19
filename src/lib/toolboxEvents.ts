/**
 * One Toolbox event, as a webhook delivery's `data` or one entry of
 * `GET /api/v1/organisers/:id/events`. Both are `{ kind, ...the event row }`
 * (`mapDeveloperAdhocEvent` in the Toolbox repo). The `startsAt`/`endsAt`
 * spelling is the SU sync job's, which also posts to the webhook route.
 */
export interface ToolboxEventData {
  kind?: string;
  id?: string;
  suuEventId?: string;
  title?: string;
  description?: string | null;
  startTime?: string;
  endTime?: string | null;
  startsAt?: string;
  endsAt?: string | null;
  isAllDay?: boolean;
  location?: string | null;
  locationUrl?: string | null;
  imageUrl?: string | null;
  supersededById?: string | null;
  status?: string;
  capacity?: number;
  ticketsSold?: number;
  pricePence?: number;
}

export const TOOLBOX_EVENT_SOURCE = "toolbox";

const STATUSES = ["upcoming", "sold_out", "cancelled", "completed", "draft"];

export type ToolboxEventMapping =
  | { ok: true; id: string; row: Record<string, unknown> }
  | { ok: false; id?: string; skip: true; reason: string }
  | { ok: false; id?: string; skip: false; reason: string };

/** http(s) only: these land in an href on the Events tab. */
function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The `events` row for one Toolbox event, carrying only the fields the payload
 * actually had. It is an upsert merge: capacity, tickets and price belong to the
 * SU sync job, and Toolbox never sends them, so writing them unconditionally
 * would zero whatever the job stored.
 *
 * Skipped rather than failed: weekly `timetable` events (their `startTime` is
 * "HH:MM", not a date, and would be refused by the timestamptz column) and rows
 * Toolbox has marked as a duplicate of another.
 */
export function toolboxEventRow(data: ToolboxEventData, syncedAt: string): ToolboxEventMapping {
  const id = data.suuEventId || data.id;
  if (!id) return { ok: false, skip: false, reason: "id is required" };
  if (data.kind && data.kind !== "adhoc") return { ok: false, id, skip: true, reason: `${data.kind} events are not shown` };
  if (data.supersededById) return { ok: false, id, skip: true, reason: "superseded by another event" };
  // `events.title` is `not null` with no default. Toolbox's own schema requires a
  // title, so an absent one is a bug at the sender, and saying so beats inventing one.
  if (!data.title) return { ok: false, id, skip: false, reason: "title is required" };

  const row: Record<string, unknown> = { suu_event_id: id, title: data.title, synced_at: syncedAt };
  const startsAt = data.startsAt ?? data.startTime;
  if (startsAt) row.starts_at = startsAt;
  const endsAt = data.endsAt ?? data.endTime;
  if (endsAt) row.ends_at = endsAt;
  if (data.location) row.location = data.location;
  if (STATUSES.includes(String(data.status))) row.status = String(data.status);
  if (typeof data.capacity === "number") row.capacity = Math.max(0, data.capacity);
  if (typeof data.ticketsSold === "number") row.tickets_sold = Math.max(0, data.ticketsSold);
  if (typeof data.pricePence === "number") row.price_pence = Math.max(0, data.pricePence);

  // Only a Toolbox-shaped payload (it has `kind`) owns these, and it always sends
  // the whole row, so an absent or null value really does mean "cleared".
  if (data.kind === "adhoc") {
    row.source = TOOLBOX_EVENT_SOURCE;
    row.description = typeof data.description === "string" && data.description.trim() ? data.description.trim() : null;
    row.location_url = safeUrl(data.locationUrl);
    row.image_url = safeUrl(data.imageUrl);
    row.is_all_day = data.isAllDay === true;
  }

  return { ok: true, id, row };
}
