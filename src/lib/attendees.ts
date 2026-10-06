import { can, type AccessProfile } from "@/lib/access";
import type { EventPlan } from "@/lib/eventPlans";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Who is on a walk. SU ticketholders arrive from Adam's Campus Toolbox; the
 * leader adds anyone else on the day. Checking in and "all back" are recorded
 * on the same rows, so the register is also the attendance history.
 */
export interface Attendee {
  id: string;
  event_suu_id: string;
  member_id: string | null;
  name: string;
  email: string | null;
  source: "toolbox" | "leader";
  removed: boolean;
  checked_in_at: string | null;
  returned_at: string | null;
}

/** One row of Toolbox's attendee list (GET /api/v1/organisers/:id/events/:eventId/attendees). */
export interface ToolboxAttendee {
  name?: string | null;
  email?: string | null;
}

export interface MemberRef {
  id: string;
  email: string;
  full_name: string | null;
}

export interface AttendeeSyncPlan {
  insert: Omit<Attendee, "id" | "checked_in_at" | "returned_at">[];
  /** Rows whose name or member link changed, or that came back after a refund was reversed. */
  update: { id: string; name: string; member_id: string | null; removed: boolean }[];
  /** Toolbox rows no longer on the list: a refund. Kept for history, hidden from the register. */
  remove: string[];
}

function normEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.includes("@") ? email : null;
}

/**
 * What to change so the stored list matches Toolbox's. Leader-added rows are
 * never touched, and nobody who has been checked in is removed: if they are
 * on the hill, they are on the register.
 */
export function planAttendeeSync(
  eventSuuId: string,
  existing: Attendee[],
  incoming: ToolboxAttendee[],
  members: MemberRef[],
): AttendeeSyncPlan {
  const memberByEmail = new Map(members.map((m) => [m.email.toLowerCase(), m]));
  const existingByEmail = new Map(existing.filter((a) => a.email).map((a) => [a.email!.toLowerCase(), a]));
  const existingByMember = new Map(existing.filter((a) => a.member_id).map((a) => [a.member_id!, a]));
  const plan: AttendeeSyncPlan = { insert: [], update: [], remove: [] };
  const seen = new Set<string>();

  for (const row of incoming) {
    const email = normEmail(row.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const member = memberByEmail.get(email) ?? null;
    const name = (typeof row.name === "string" && row.name.trim()) || member?.full_name || email.split("@")[0];
    const current = existingByEmail.get(email) ?? (member ? existingByMember.get(member.id) : undefined);

    if (!current) {
      plan.insert.push({ event_suu_id: eventSuuId, member_id: member?.id ?? null, name, email, source: "toolbox", removed: false });
      continue;
    }
    if (current.source !== "toolbox") continue;
    const memberId = member?.id ?? current.member_id;
    if (current.name !== name || current.member_id !== memberId || current.removed) {
      plan.update.push({ id: current.id, name, member_id: memberId, removed: false });
    }
  }

  // An empty list is more likely a Toolbox hiccup than everyone refunding.
  if (seen.size) {
    for (const row of existing) {
      if (row.source !== "toolbox" || row.removed || row.checked_in_at) continue;
      if (!row.email || !seen.has(row.email.toLowerCase())) plan.remove.push(row.id);
    }
  }
  return plan;
}

export type WalkRole = "leader" | "backmarker" | "committee";

/** The viewer's part in running this walk, if any. */
export function walkRole(
  viewer: { id: string } & AccessProfile,
  plan: Pick<EventPlan, "leader_member_id" | "backmarker_member_id"> | null,
): WalkRole | null {
  if (plan?.leader_member_id === viewer.id) return "leader";
  if (plan?.backmarker_member_id === viewer.id) return "backmarker";
  if (can(viewer, "manage_walks")) return "committee";
  return null;
}

export interface Headcount {
  expected: number;
  checkedIn: number;
  missing: number;
  returned: number;
}

export function headcount(attendees: Pick<Attendee, "removed" | "checked_in_at" | "returned_at">[]): Headcount {
  const present = attendees.filter((a) => !a.removed);
  const checkedIn = present.filter((a) => a.checked_in_at).length;
  return {
    expected: present.length,
    checkedIn,
    missing: present.length - checkedIn,
    returned: present.filter((a) => a.returned_at).length,
  };
}

/** One queued change from the day-of page, replayed when the phone is back online. */
export type AttendanceOp =
  | { kind: "check_in"; attendeeId: string; at: string }
  | { kind: "undo_check_in"; attendeeId: string; at: string }
  | { kind: "all_back"; at: string };

export function parseAttendanceOps(value: unknown): AttendanceOp[] | null {
  if (!Array.isArray(value) || value.length > 500) return null;
  const ops: AttendanceOp[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const op = raw as Record<string, unknown>;
    const at = typeof op.at === "string" && !Number.isNaN(Date.parse(op.at)) ? new Date(op.at).toISOString() : null;
    if (!at) return null;
    if (op.kind === "all_back") ops.push({ kind: "all_back", at });
    else if ((op.kind === "check_in" || op.kind === "undo_check_in") && typeof op.attendeeId === "string") {
      ops.push({ kind: op.kind, attendeeId: op.attendeeId, at });
    } else return null;
  }
  return ops;
}

/**
 * Collapse a queue to the last word on each person, so replaying a morning of
 * taps offline sends one write per attendee.
 */
export function collapseOps(ops: AttendanceOp[]): { checkIns: Map<string, string | null>; allBackAt: string | null } {
  const checkIns = new Map<string, string | null>();
  let allBackAt: string | null = null;
  for (const op of ops) {
    if (op.kind === "all_back") allBackAt = op.at;
    else checkIns.set(op.attendeeId, op.kind === "check_in" ? op.at : null);
  }
  return { checkIns, allBackAt };
}

const ATTENDEE_COLUMNS = "id, event_suu_id, member_id, name, email, source, removed, checked_in_at, returned_at";

/** A walk's attendees; a missing table reads as nobody, like event plans. */
export async function getAttendees(eventSuuId: string): Promise<Attendee[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("event_attendees")
    .select(ATTENDEE_COLUMNS)
    .eq("event_suu_id", eventSuuId)
    .order("name");
  return error ? [] : ((data ?? []) as Attendee[]);
}

/** Every walk a member was on, for their log. */
export async function getMemberAttendance(memberId: string): Promise<Attendee[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("event_attendees")
    .select(ATTENDEE_COLUMNS)
    .eq("member_id", memberId)
    .eq("removed", false);
  return error ? [] : ((data ?? []) as Attendee[]);
}

export type ToolboxAttendeeFetch =
  | { status: "ok"; attendees: ToolboxAttendee[]; syncedAt: string }
  | { status: "not_linked"; reason: string }
  | { status: "not_found"; reason: string }
  | { status: "unavailable"; reason: string }
  | { status: "error"; reason: string };

/**
 * Toolbox's attendee list for one event. A 403 means the token lacks
 * ATTENDEES_READ, which stops the whole sync. A 404 is this event only: Toolbox
 * doesn't know it, or another society hosts it.
 *
 * The list exists only once a principal has linked the walk to its SU
 * ticket-sales page in the Connector and read it; until then Toolbox answers
 * `linked: false` (or `syncedAt: null`), which is per walk, so the sync moves
 * on to the next one. Toolbox clears a list 7 days after the walk.
 */
export async function fetchToolboxAttendees(eventSuuId: string): Promise<ToolboxAttendeeFetch> {
  const token = process.env.TOOLBOX_API_TOKEN;
  const organiserId = process.env.TOOLBOX_ORGANISER_ID;
  if (!token || !organiserId) return { status: "unavailable", reason: "TOOLBOX_API_TOKEN and TOOLBOX_ORGANISER_ID are not set" };
  const toolbox = (process.env.TOOLBOX_URL || "https://www.adamscampustoolbox.org.uk").replace(/\/$/, "");
  try {
    const res = await fetch(
      `${toolbox}/api/v1/organisers/${encodeURIComponent(organiserId)}/events/${encodeURIComponent(eventSuuId)}/attendees`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) },
    );
    if (res.status === 404) return { status: "not_found", reason: "Toolbox doesn't host this event for the club" };
    if (res.status === 403 || res.status === 401) return { status: "unavailable", reason: `Toolbox returned ${res.status}` };
    if (!res.ok) return { status: "error", reason: `Toolbox returned ${res.status}` };
    const body = (await res.json()) as { attendees?: unknown; linked?: unknown; syncedAt?: unknown };
    if (body.linked === false) return { status: "not_linked", reason: "Not linked to its SU ticket page yet" };
    if (body.syncedAt === null) return { status: "not_linked", reason: "Linked, but nobody has read the SU ticket page yet" };
    if (!Array.isArray(body.attendees) || typeof body.syncedAt !== "string") return { status: "error", reason: "Toolbox returned no attendee list" };
    return { status: "ok", attendees: body.attendees as ToolboxAttendee[], syncedAt: body.syncedAt };
  } catch {
    return { status: "error", reason: "Toolbox is unreachable" };
  }
}

/** Toolbox asks that a list be checked at most this often. */
export const TICKET_LIST_INTERVAL_MS = 15 * 60_000;

export interface TicketListCheck {
  checked_at: string;
  synced_at: string | null;
  status: string;
}

/** When this walk's ticket list was last asked for, and how old it was then. */
export async function getTicketListCheck(eventSuuId: string): Promise<TicketListCheck | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("ticket_list_checks")
    .select("checked_at, synced_at, status")
    .eq("event_suu_id", eventSuuId)
    .maybeSingle();
  return error ? null : ((data as TicketListCheck | null) ?? null);
}

/**
 * Fetch and apply one event's list. Returns what happened, for the sync log and
 * the day page. Asked again within 15 minutes, it answers "recent" from the
 * last check instead of asking Toolbox.
 */
export async function syncEventAttendees(eventSuuId: string) {
  const supabase = getSupabaseAdmin();
  const last = await getTicketListCheck(eventSuuId);
  if (last && Date.now() - Date.parse(last.checked_at) < TICKET_LIST_INTERVAL_MS) {
    return { status: "recent" as const, syncedAt: last.synced_at, inserted: 0, updated: 0, removed: 0 };
  }

  const fetched = await fetchToolboxAttendees(eventSuuId);
  // A network failure never reached Toolbox, so it doesn't count as a check.
  if (fetched.status !== "error" || fetched.reason !== "Toolbox is unreachable") {
    await supabase.from("ticket_list_checks").upsert({
      event_suu_id: eventSuuId,
      checked_at: new Date().toISOString(),
      synced_at: fetched.status === "ok" ? fetched.syncedAt : null,
      status: fetched.status,
    });
  }
  if (fetched.status !== "ok") return { ...fetched, inserted: 0, updated: 0, removed: 0 };

  const emails = [...new Set(fetched.attendees.map((a) => normEmail(a.email)).filter((e): e is string => Boolean(e)))];
  const [existing, members] = await Promise.all([
    getAttendees(eventSuuId),
    emails.length
      ? supabase.from("members").select("id, email, full_name").in("email", emails).is("revoked_at", null)
      : Promise.resolve({ data: [] as MemberRef[] }),
  ]);
  const plan = planAttendeeSync(eventSuuId, existing, fetched.attendees, (members.data ?? []) as MemberRef[]);

  if (plan.insert.length) {
    const { error } = await supabase.from("event_attendees").insert(plan.insert);
    if (error) return { status: "error" as const, reason: error.message, inserted: 0, updated: 0, removed: 0 };
  }
  for (const row of plan.update) {
    await supabase.from("event_attendees").update({ name: row.name, member_id: row.member_id, removed: row.removed }).eq("id", row.id);
  }
  if (plan.remove.length) {
    await supabase.from("event_attendees").update({ removed: true }).in("id", plan.remove);
  }
  return { status: "ok" as const, syncedAt: fetched.syncedAt, inserted: plan.insert.length, updated: plan.update.length, removed: plan.remove.length };
}

/** Toolbox deletes a ticket list 7 days after the event; copies here go then too. */
export const TICKET_LIST_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Drop what came from Toolbox for walks that ended over 7 days ago. Ticketholders who
 * never turned up and aren't members go entirely, as do refunds. Everyone else
 * stays as attendance history (name and member link), without the email.
 */
export async function purgeExpiredTicketHolders(now = Date.now()): Promise<{ deleted: number; scrubbed: number }> {
  if (!isSupabaseConfigured()) return { deleted: 0, scrubbed: 0 };
  const supabase = getSupabaseAdmin();
  const { data: rows } = await supabase.from("event_attendees").select("event_suu_id").eq("source", "toolbox").not("email", "is", null);
  const ids = [...new Set((rows ?? []).map((r) => r.event_suu_id as string))];
  if (!ids.length) return { deleted: 0, scrubbed: 0 };
  const { data: events } = await supabase.from("events").select("suu_event_id, starts_at, ends_at").in("suu_event_id", ids);
  const cutoff = now - TICKET_LIST_RETENTION_MS;
  const expired = (events ?? [])
    .filter((e) => {
      const end = (e.ends_at ?? e.starts_at) as string | null;
      return end !== null && Date.parse(end) < cutoff;
    })
    .map((e) => e.suu_event_id as string);
  if (!expired.length) return { deleted: 0, scrubbed: 0 };

  const base = () => supabase.from("event_attendees").delete({ count: "exact" }).eq("source", "toolbox").in("event_suu_id", expired);
  const [refunds, noShows] = await Promise.all([
    base().eq("removed", true),
    base().is("member_id", null).is("checked_in_at", null),
  ]);
  const { count: scrubbed } = await supabase
    .from("event_attendees")
    .update({ email: null }, { count: "exact" })
    .eq("source", "toolbox")
    .in("event_suu_id", expired)
    .not("email", "is", null);
  return { deleted: (refunds.count ?? 0) + (noShows.count ?? 0), scrubbed: scrubbed ?? 0 };
}
