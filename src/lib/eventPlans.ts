import { can, type AccessProfile } from "@/lib/access";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/**
 * The trip brief a leader writes on top of the Toolbox post: who leads, where
 * and when to meet, transport, kit, and the links. Stored by the event's SU id
 * because Toolbox's reconcile recreates event rows with new uuids.
 */
export interface EventPlan {
  event_suu_id: string;
  leader_member_id: string | null;
  backmarker_member_id: string | null;
  meet_at: string | null;
  meet_point: string | null;
  transport: string | null;
  kit_list: string[];
  route_url: string | null;
  booking_url: string | null;
  notes: string | null;
  updated_at?: string;
}

export interface PlanPerson {
  id: string;
  full_name: string | null;
}

export interface EventPlanView extends EventPlan {
  leader: PlanPerson | null;
  backmarker: PlanPerson | null;
}

export type PlanInput = Omit<EventPlan, "event_suu_id" | "updated_at">;

const TEXT_LIMIT = 2000;
const KIT_LIMIT = 40;

function text(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

function url(value: unknown): string | null {
  const raw = text(value, 1000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function memberId(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

/** One kit item per line or array entry; blanks and repeats dropped. */
export function parseKitList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split("\n") : [];
  const seen = new Set<string>();
  const kit: string[] = [];
  for (const item of items) {
    const name = text(item, 80);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    kit.push(name);
    if (kit.length >= KIT_LIMIT) break;
  }
  return kit;
}

/**
 * Turn a request body into a plan, or say which field is wrong. A link that is
 * not http(s) is refused rather than dropped, so a leader sees the mistake.
 */
export function parsePlanInput(body: unknown): { ok: true; plan: PlanInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Send the plan as JSON." };
  const b = body as Record<string, unknown>;

  let meetAt: string | null = null;
  if (b.meet_at !== undefined && b.meet_at !== null && b.meet_at !== "") {
    const when = new Date(String(b.meet_at));
    if (Number.isNaN(when.getTime())) return { ok: false, error: "The meeting time isn't a date." };
    meetAt = when.toISOString();
  }

  for (const field of ["route_url", "booking_url"] as const) {
    if (text(b[field]) && !url(b[field])) {
      return { ok: false, error: field === "route_url" ? "The route link must start with https://." : "The booking link must start with https://." };
    }
  }

  return {
    ok: true,
    plan: {
      leader_member_id: memberId(b.leader_member_id),
      backmarker_member_id: memberId(b.backmarker_member_id),
      meet_at: meetAt,
      meet_point: text(b.meet_point),
      transport: text(b.transport, 500),
      kit_list: parseKitList(b.kit_list),
      route_url: url(b.route_url),
      booking_url: url(b.booking_url),
      notes: text(b.notes, TEXT_LIMIT),
    },
  };
}

/** Who may write a plan: walk leaders and every governance role. */
export function canEditPlan(profile: AccessProfile): boolean {
  return can(profile, "lead_walks");
}

/**
 * A walk leader can write the brief but not reassign who leads it; that is the
 * committee's call. So a leader's save keeps the stored leader and backmarker.
 */
export function mergePlanForEditor(
  profile: AccessProfile,
  input: PlanInput,
  existing: Pick<EventPlan, "leader_member_id" | "backmarker_member_id"> | null,
): PlanInput {
  if (can(profile, "manage_walks")) return input;
  return {
    ...input,
    leader_member_id: existing?.leader_member_id ?? null,
    backmarker_member_id: existing?.backmarker_member_id ?? null,
  };
}

const PLAN_SELECT =
  "*, leader:leader_member_id (id, full_name), backmarker:backmarker_member_id (id, full_name)";

/**
 * The plan for one event, or null. A missing table (a deploy whose migration
 * hasn't run, or local dev against production) reads as no plan, not an error.
 */
export async function getEventPlan(eventSuuId: string | null): Promise<EventPlanView | null> {
  if (!eventSuuId || !isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("event_plans")
    .select(PLAN_SELECT)
    .eq("event_suu_id", eventSuuId)
    .maybeSingle();
  if (error) return null;
  return (data as EventPlanView | null) ?? null;
}

/** Plans for many events at once, keyed by SU id. Same missing-table rule. */
export async function getEventPlans(eventSuuIds: string[]): Promise<Map<string, EventPlanView>> {
  const plans = new Map<string, EventPlanView>();
  const ids = [...new Set(eventSuuIds.filter(Boolean))];
  if (!ids.length || !isSupabaseConfigured()) return plans;
  const { data, error } = await getSupabaseAdmin().from("event_plans").select(PLAN_SELECT).in("event_suu_id", ids);
  if (error) return plans;
  for (const row of (data ?? []) as EventPlanView[]) plans.set(row.event_suu_id, row);
  return plans;
}

export async function saveEventPlan(eventSuuId: string, plan: PlanInput, editorId: string) {
  return getSupabaseAdmin()
    .from("event_plans")
    .upsert({ event_suu_id: eventSuuId, ...plan, updated_by: editorId }, { onConflict: "event_suu_id" })
    .select(PLAN_SELECT)
    .single();
}
