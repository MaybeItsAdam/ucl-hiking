import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { audit } from "@/lib/audit";
import { parseIncident } from "@/lib/incidents";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/** Principals review incidents; the list is theirs alone. */
export async function GET() {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!can(profileOf(member), "review_incidents")) return NextResponse.json({ error: "Only principals see incident reports." }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ incidents: [] });
  const { data, error } = await getSupabaseAdmin()
    .from("incident_reports")
    .select("*, reporter:reporter_member_id (full_name)")
    .order("occurred_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: "Incident reports aren't set up yet." }, { status: 503 });
  return NextResponse.json({ incidents: data ?? [] });
}

/** Leaders and committee file a report, usually from the day-of page. */
export async function POST(request: Request) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!can(profileOf(member), "lead_walks")) return NextResponse.json({ error: "Only walk leaders and committee file reports." }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Reports need the database." }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send the report as JSON." }, { status: 400 });
  }
  const parsed = parseIncident(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await getSupabaseAdmin()
    .from("incident_reports")
    .insert({ ...parsed.incident, reporter_member_id: member.id })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: "The report wasn't saved. Try again." }, { status: 500 });
  await audit(member.id, "incident.reported", "incident", data.id, { kind: parsed.incident.kind, event: parsed.incident.event_suu_id });
  return NextResponse.json({ ok: true, id: data.id });
}

/** Principals close or reopen a report. */
export async function PATCH(request: Request) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!can(profileOf(member), "review_incidents")) return NextResponse.json({ error: "Only principals close reports." }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Reports need the database." }, { status: 503 });
  let body: { id?: unknown; status?: unknown; follow_up?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send the change as JSON." }, { status: 400 });
  }
  if (typeof body.id !== "string" || (body.status !== "open" && body.status !== "closed")) {
    return NextResponse.json({ error: "Say which report and whether it's open or closed." }, { status: 400 });
  }
  const update: Record<string, unknown> = { status: body.status };
  if (typeof body.follow_up === "string") update.follow_up = body.follow_up.trim().slice(0, 4000) || null;
  const { error } = await getSupabaseAdmin().from("incident_reports").update(update).eq("id", body.id);
  if (error) return NextResponse.json({ error: "The report wasn't updated." }, { status: 500 });
  await audit(member.id, `incident.${body.status}`, "incident", body.id);
  return NextResponse.json({ ok: true });
}
