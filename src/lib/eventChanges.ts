import { eventDetails } from "@/lib/eventDetails";
import { eventWhen, longDate } from "@/lib/eventList";
import { notify, walkRecipients } from "@/lib/notify";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { SUEvent } from "@/lib/types";

type EventFields = Pick<SUEvent, "title" | "starts_at" | "ends_at" | "location" | "status" | "is_all_day">;

/** A walk moved by less than this is a typo fix, not news. */
const MOVE_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * What changed that the people on a walk need to hear about: it was
 * cancelled, or moved, or the place changed. Anything else (wording, photos,
 * ticket counts) isn't worth a notification.
 */
export function describeEventChange(before: EventFields, after: Partial<EventFields>): { title: string; body: string } | null {
  const next = { ...before, ...after } as EventFields;
  const name = eventDetails({ ...next, description: null }).name;

  if (next.status === "cancelled" && before.status !== "cancelled") {
    return { title: `Cancelled: ${name}`, body: before.starts_at ? `It was on ${longDate(before.starts_at)}.` : "It won't go ahead." };
  }
  if (before.status === "cancelled" && next.status !== "cancelled") {
    return { title: `Back on: ${name}`, body: next.starts_at ? `${longDate(next.starts_at)} · ${eventWhen(next)}` : "Check the details." };
  }

  const moved =
    before.starts_at &&
    next.starts_at &&
    Math.abs(new Date(next.starts_at).getTime() - new Date(before.starts_at).getTime()) >= MOVE_THRESHOLD_MS;
  const relocated = Boolean(before.location && next.location && before.location.trim() !== next.location.trim());
  if (moved && relocated) {
    return { title: `Changed: ${name}`, body: `Now ${longDate(next.starts_at!)} · ${eventWhen(next)}, at ${next.location}.` };
  }
  if (moved) return { title: `New time: ${name}`, body: `Now ${longDate(next.starts_at!)} · ${eventWhen(next)}.` };
  if (relocated) return { title: `New place: ${name}`, body: `Now at ${next.location}.` };
  return null;
}

/** The stored rows for some SU ids, before an upsert overwrites them. Never throws. */
export async function eventsBefore(suuIds: string[]): Promise<Map<string, SUEvent>> {
  const out = new Map<string, SUEvent>();
  try {
    const { data } = await getSupabaseAdmin().from("events").select("*").in("suu_event_id", suuIds);
    for (const row of (data ?? []) as SUEvent[]) if (row.suu_event_id) out.set(row.suu_event_id, row);
  } catch {
    // No snapshot, no notifications; the upsert itself must still happen.
  }
  return out;
}

/** Tell attendees about any upcoming walk that changed. Best effort. */
export async function notifyEventChanges(before: Map<string, SUEvent>, rows: Record<string, unknown>[]) {
  const now = Date.now();
  for (const row of rows) {
    const id = row.suu_event_id as string | undefined;
    const old = id ? before.get(id) : undefined;
    if (!old?.starts_at || new Date(old.ends_at ?? old.starts_at).getTime() < now) continue;
    const change = describeEventChange(old, row as Partial<EventFields>);
    if (!change) continue;
    const recipients = await walkRecipients(id!);
    if (recipients.length) await notify(recipients, { kind: "event_changed", ...change, url: `/portal/events/${old.id}` });
  }
}
