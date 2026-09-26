import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { audit } from "@/lib/audit";
import { canEditPlan, getEventPlan, mergePlanForEditor, parsePlanInput, saveEventPlan } from "@/lib/eventPlans";
import { getEvent } from "@/lib/events";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

type Params = { params: Promise<{ id: string }> };

/** The plan plus, for committee, who can be picked to lead or backmark. */
export async function GET(_request: Request, { params }: Params) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const profile = profileOf(member);
  if (!canEditPlan(profile)) return NextResponse.json({ error: "Only walk leaders and committee edit plans." }, { status: 403 });

  const event = await getEvent((await params).id);
  if (!event?.suu_event_id) return NextResponse.json({ error: "No such event." }, { status: 404 });

  const plan = await getEventPlan(event.suu_event_id);
  let leaders: { id: string; full_name: string | null }[] = [];
  if (can(profile, "manage_walks") && isSupabaseConfigured()) {
    const { data } = await getSupabaseAdmin()
      .from("members")
      .select("id, full_name")
      .is("revoked_at", null)
      .or("is_walk_leader.eq.true,governance_role.not.is.null")
      .order("full_name");
    leaders = data ?? [];
  }
  return NextResponse.json({ plan, leaders, canAssign: can(profile, "manage_walks") });
}

export async function PUT(request: Request, { params }: Params) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const profile = profileOf(member);
  if (!canEditPlan(profile)) return NextResponse.json({ error: "Only walk leaders and committee edit plans." }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Plans need the database." }, { status: 503 });

  const event = await getEvent((await params).id);
  if (!event?.suu_event_id) return NextResponse.json({ error: "No such event." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send the plan as JSON." }, { status: 400 });
  }
  const parsed = parsePlanInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const existing = await getEventPlan(event.suu_event_id);
  const plan = mergePlanForEditor(profile, parsed.plan, existing);
  const { data, error } = await saveEventPlan(event.suu_event_id, plan, member.id);
  if (error) return NextResponse.json({ error: "The plan wasn't saved. Try again." }, { status: 500 });

  await audit(member.id, "event.plan_saved", "event", event.suu_event_id, {
    leader: plan.leader_member_id,
    backmarker: plan.backmarker_member_id,
  });
  return NextResponse.json({ ok: true, plan: data });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Committee assign the leader or backmarker from the rota, leaving the rest of the plan alone. */
export async function PATCH(request: Request, { params }: Params) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!can(profileOf(member), "manage_walks")) return NextResponse.json({ error: "Only committee assign leaders." }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Plans need the database." }, { status: 503 });

  const event = await getEvent((await params).id);
  if (!event?.suu_event_id) return NextResponse.json({ error: "No such event." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send it as JSON." }, { status: 400 });
  }
  const update: Record<string, string | null> = {};
  for (const field of ["leader_member_id", "backmarker_member_id"] as const) {
    if (!(field in body)) continue;
    const value = body[field];
    if (value !== null && !(typeof value === "string" && UUID.test(value))) {
      return NextResponse.json({ error: "Pick someone from the list." }, { status: 400 });
    }
    update[field] = value as string | null;
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const { error } = await getSupabaseAdmin()
    .from("event_plans")
    .upsert({ event_suu_id: event.suu_event_id, ...update, updated_by: member.id }, { onConflict: "event_suu_id" });
  if (error) return NextResponse.json({ error: "That wasn't saved. Try again." }, { status: 500 });
  await audit(member.id, "event.leaders_assigned", "event", event.suu_event_id, update);
  return NextResponse.json({ ok: true });
}
