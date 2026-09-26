import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { audit } from "@/lib/audit";
import { parsePounds } from "@/lib/finance";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

async function guard() {
  const member = await getCurrentMember();
  if (!member) return { error: NextResponse.json({ error: "Sign in first." }, { status: 401 }) };
  if (!can(profileOf(member), "manage_money")) return { error: NextResponse.json({ error: "Only principals see club money." }, { status: 403 }) };
  if (!isSupabaseConfigured()) return { error: NextResponse.json({ error: "Money needs the database." }, { status: 503 }) };
  return { member };
}

/** Add an income or expense line to a trip. */
export async function POST(request: Request) {
  const { member, error: denied } = await guard();
  if (denied) return denied;
  let body: { event_suu_id?: unknown; kind?: unknown; label?: unknown; amount?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send it as JSON." }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : "";
  const amount = parsePounds(body.amount);
  if (typeof body.event_suu_id !== "string" || !body.event_suu_id) return NextResponse.json({ error: "Which trip?" }, { status: 400 });
  if (body.kind !== "income" && body.kind !== "expense") return NextResponse.json({ error: "Income or expense?" }, { status: 400 });
  if (!label) return NextResponse.json({ error: "Say what it's for, e.g. “Coach”." }, { status: 400 });
  if (amount === null) return NextResponse.json({ error: "The amount should be like 245.50." }, { status: 400 });

  const { data, error } = await getSupabaseAdmin()
    .from("event_finance_lines")
    .insert({ event_suu_id: body.event_suu_id, kind: body.kind, label, amount_pence: amount, created_by: member!.id })
    .select("id, event_suu_id, kind, label, amount_pence")
    .single();
  if (error) return NextResponse.json({ error: "That wasn't saved." }, { status: 500 });
  await audit(member!.id, "money.line_added", "event", body.event_suu_id, { kind: body.kind, label, amount_pence: amount });
  return NextResponse.json({ ok: true, line: data });
}

export async function DELETE(request: Request) {
  const { member, error: denied } = await guard();
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which line?" }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().from("event_finance_lines").delete().eq("id", id).select("event_suu_id, kind, label, amount_pence").maybeSingle();
  if (error) return NextResponse.json({ error: "That wasn't deleted." }, { status: 500 });
  if (data) await audit(member!.id, "money.line_deleted", "event", data.event_suu_id, data);
  return NextResponse.json({ ok: true });
}
