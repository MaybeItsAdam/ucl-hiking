import { NextResponse } from "next/server";
import { getRealMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/** The member's inbox, newest first, and how many are unread. `?count=1` returns just the count. */
export async function GET(request: Request) {
  const member = await getRealMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ notifications: [], unread: 0 });
  const supabase = getSupabaseAdmin();
  const unreadRes = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("member_id", member.id)
    .is("read_at", null);
  if (unreadRes.error) return NextResponse.json({ notifications: [], unread: 0 });
  if (new URL(request.url).searchParams.get("count")) return NextResponse.json({ unread: unreadRes.count ?? 0 });
  const { data } = await supabase
    .from("notifications")
    .select("id, kind, title, body, url, read_at, created_at")
    .eq("member_id", member.id)
    .order("created_at", { ascending: false })
    .limit(100);
  return NextResponse.json({ notifications: data ?? [], unread: unreadRes.count ?? 0 });
}
