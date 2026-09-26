import { NextResponse } from "next/server";
import { getRealMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/**
 * The phone app registers its FCM token here after sign-in. A token belongs to
 * one install, so a different member signing in on the same phone takes it over.
 */
export async function POST(request: Request) {
  const member = await getRealMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Push needs the database." }, { status: 503 });
  let body: { token?: unknown; platform?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send the token as JSON." }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 4096) return NextResponse.json({ error: "No token." }, { status: 400 });
  if (body.platform !== "android" && body.platform !== "ios") return NextResponse.json({ error: "Unknown platform." }, { status: 400 });
  const { error } = await getSupabaseAdmin()
    .from("push_tokens")
    .upsert({ token, member_id: member.id, platform: body.platform, last_seen_at: new Date().toISOString() }, { onConflict: "token" });
  if (error) return NextResponse.json({ error: "The token wasn't saved." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Signing out of the app stops its pushes. */
export async function DELETE(request: Request) {
  const member = await getRealMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });
  const token = new URL(request.url).searchParams.get("token");
  if (token) await getSupabaseAdmin().from("push_tokens").delete().eq("token", token).eq("member_id", member.id);
  return NextResponse.json({ ok: true });
}
