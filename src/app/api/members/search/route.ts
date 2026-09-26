import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Name lookup for leaders adding someone to a register or committee picking a
 * leader. Names only, never emails, and at most ten.
 */
export async function GET(request: Request) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!can(profileOf(member), "lead_walks")) return NextResponse.json({ error: "Only walk leaders and committee search members." }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ members: [] });

  // PostgREST filter syntax is built from this string, so keep only what a name contains.
  const q = (new URL(request.url).searchParams.get("q") ?? "").replace(/[^\p{L}\p{M}\s'-]/gu, "").trim().slice(0, 60);
  if (q.length < 2) return NextResponse.json({ members: [] });

  const { data } = await getSupabaseAdmin()
    .from("members")
    .select("id, full_name, membership_tier")
    .is("revoked_at", null)
    .ilike("full_name", `%${q}%`)
    .order("full_name")
    .limit(10);
  return NextResponse.json({ members: data ?? [] });
}
