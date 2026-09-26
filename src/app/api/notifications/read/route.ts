import { NextResponse } from "next/server";
import { getRealMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/** Mark some (`ids`) or all of the member's notifications read. */
export async function POST(request: Request) {
  const member = await getRealMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });
  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  let query = getSupabaseAdmin()
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("member_id", member.id)
    .is("read_at", null);
  if (Array.isArray(body.ids)) {
    const ids = body.ids.filter((id): id is string => typeof id === "string").slice(0, 200);
    if (!ids.length) return NextResponse.json({ ok: true });
    query = query.in("id", ids);
  }
  const { error } = await query;
  if (error) return NextResponse.json({ error: "Couldn't mark them read." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
