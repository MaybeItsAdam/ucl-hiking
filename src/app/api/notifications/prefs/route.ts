import { NextResponse } from "next/server";
import { isNotificationKind, NOTIFICATION_KINDS, NOTIFICATION_LABELS } from "@/lib/notify";
import { getRealMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export async function GET() {
  const member = await getRealMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const enabled: Record<string, boolean> = Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, true]));
  if (isSupabaseConfigured()) {
    const { data } = await getSupabaseAdmin().from("notification_prefs").select("kind, enabled").eq("member_id", member.id);
    for (const row of data ?? []) if (isNotificationKind(row.kind)) enabled[row.kind] = row.enabled;
  }
  return NextResponse.json({ enabled });
}

export async function PUT(request: Request) {
  const member = await getRealMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Settings need the database." }, { status: 503 });
  let body: { kind?: unknown; enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send it as JSON." }, { status: 400 });
  }
  if (!isNotificationKind(body.kind) || typeof body.enabled !== "boolean") return NextResponse.json({ error: "Which kind, on or off?" }, { status: 400 });
  if (!NOTIFICATION_LABELS[body.kind].optional) return NextResponse.json({ error: "Walk changes can't be turned off." }, { status: 400 });
  const { error } = await getSupabaseAdmin()
    .from("notification_prefs")
    .upsert({ member_id: member.id, kind: body.kind, enabled: body.enabled, updated_at: new Date().toISOString() }, { onConflict: "member_id,kind" });
  if (error) return NextResponse.json({ error: "That wasn't saved." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
