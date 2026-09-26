import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { isAvailability } from "@/lib/rota";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/** A leader says whether they can lead a walk. `status: null` clears it. */
export async function PUT(request: Request) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!can(profileOf(member), "lead_walks")) return NextResponse.json({ error: "Only walk leaders and committee use the rota." }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "The rota needs the database." }, { status: 503 });

  let body: { event_suu_id?: unknown; status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send it as JSON." }, { status: 400 });
  }
  if (typeof body.event_suu_id !== "string" || !body.event_suu_id) return NextResponse.json({ error: "Which walk?" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: event } = await supabase.from("events").select("suu_event_id").eq("suu_event_id", body.event_suu_id).maybeSingle();
  if (!event) return NextResponse.json({ error: "No such walk." }, { status: 404 });

  const { error } =
    body.status === null
      ? await supabase.from("leader_availability").delete().eq("event_suu_id", body.event_suu_id).eq("member_id", member.id)
      : isAvailability(body.status)
        ? await supabase
            .from("leader_availability")
            .upsert({ event_suu_id: body.event_suu_id, member_id: member.id, status: body.status }, { onConflict: "event_suu_id,member_id" })
        : { error: { message: "bad status" } };
  if (error) return NextResponse.json({ error: "That wasn't saved. Try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
