import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { appOrigin, calendarToken } from "@/lib/ics";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

async function version(memberId: string): Promise<number | null> {
  const { data, error } = await getSupabaseAdmin().from("members").select("calendar_key_version").eq("id", memberId).maybeSingle();
  if (error || !data) return null;
  return data.calendar_key_version ?? 0;
}

function feed(memberId: string, v: number) {
  const url = `${appOrigin()}/api/calendar/${calendarToken(memberId, v)}.ics`;
  return { url, webcal: url.replace(/^https?:/, "webcal:") };
}

/** The member's feed URL. */
export async function GET() {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Calendar feeds need the database." }, { status: 503 });
  const v = await version(member.id);
  if (v === null) return NextResponse.json({ error: "Calendar feeds aren't set up yet." }, { status: 503 });
  return NextResponse.json(feed(member.id, v));
}

/** Reset: the old URL stops working and a new one is returned. */
export async function POST() {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Calendar feeds need the database." }, { status: 503 });
  const v = await version(member.id);
  if (v === null) return NextResponse.json({ error: "Calendar feeds aren't set up yet." }, { status: 503 });
  const next = v + 1;
  const { error } = await getSupabaseAdmin().from("members").update({ calendar_key_version: next }).eq("id", member.id);
  if (error) return NextResponse.json({ error: "The link wasn't reset. Try again." }, { status: 500 });
  await audit(member.id, "calendar.reset", "member", member.id);
  return NextResponse.json(feed(member.id, next));
}
