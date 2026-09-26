import type { AttendanceOp, Attendee, Headcount } from "@/lib/attendees";
import type { SafetyDetails } from "@/lib/safety";

/**
 * The day-of page keeps its register on the phone, because the car park and
 * the hill often have no signal. What is stored, and for how long:
 *
 * - the last register the server sent, including any emergency details the
 *   leader may see, deleted 24 hours after the walk ends;
 * - the check-ins tapped since, queued until the phone is back online.
 */

export interface DaySnapshot {
  event: { id: string; suu_event_id: string; title: string; starts_at: string | null; ends_at: string | null };
  role: "leader" | "backmarker" | "committee";
  leader: string | null;
  backmarker: string | null;
  attendees: Attendee[];
  headcount: Headcount;
  safety: Record<string, SafetyDetails>;
  kit: { id: string; name: string; quantity: number; status: string; borrower: string | null }[];
  lastSync: { status: string; completed_at: string; error_message: string | null } | null;
  fetchedAt: string;
}

interface Stored<T> {
  expiresAt: number;
  value: T;
}

const PREFIX = "hiking:day:";
const KEEP_AFTER_MS = 24 * 60 * 60 * 1000;

export const snapshotKey = (eventId: string) => `${PREFIX}${eventId}:snapshot`;
export const outboxKey = (eventId: string) => `${PREFIX}${eventId}:outbox`;

/** When a walk's stored register is deleted: a day after it ends, or after it starts if it has no end. */
export function expiryFor(event: Pick<DaySnapshot["event"], "starts_at" | "ends_at">, now = Date.now()): number {
  const end = event.ends_at ?? event.starts_at;
  return (end ? new Date(end).getTime() : now) + KEEP_AFTER_MS;
}

export function write<T>(storage: Storage, key: string, value: T, expiresAt: number) {
  try {
    storage.setItem(key, JSON.stringify({ expiresAt, value } satisfies Stored<T>));
  } catch {
    // Full or private mode: the page still works online.
  }
}

export function read<T>(storage: Storage, key: string, now = Date.now()): T | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored<T>;
    if (stored.expiresAt < now) {
      storage.removeItem(key);
      return null;
    }
    return stored.value;
  } catch {
    return null;
  }
}

/** Delete every stored register past its expiry, not just this walk's. */
export function purgeExpired(storage: Storage, now = Date.now()) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  for (const key of keys) read(storage, key, now);
}

/** Show queued taps on the register straight away, before the server has them. */
export function applyOps(attendees: Attendee[], ops: AttendanceOp[]): Attendee[] {
  if (!ops.length) return attendees;
  const byId = new Map(attendees.map((a) => [a.id, { ...a }]));
  for (const op of ops) {
    if (op.kind === "all_back") {
      for (const a of byId.values()) if (!a.removed && a.checked_in_at && !a.returned_at) a.returned_at = op.at;
    } else {
      const a = byId.get(op.attendeeId);
      if (a) a.checked_in_at = op.kind === "check_in" ? op.at : null;
    }
  }
  return attendees.map((a) => byId.get(a.id)!);
}
