import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { deleteSafety, hasSafetyDetails, loadSafety, parseSafetyInput, safetyConfigured, saveSafety } from "@/lib/safety";
import { getRealMember } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase";

// getRealMember, not getCurrentMember: these are the member's own details, and
// an admin previewing another role is still themselves.

function unavailable() {
  return NextResponse.json({ error: "Emergency details aren't switched on yet." }, { status: 503 });
}

export async function GET() {
  const member = await getRealMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isSupabaseConfigured() || !safetyConfigured()) return unavailable();
  const details = (await loadSafety([member.id])).get(member.id) ?? null;
  return NextResponse.json({ details });
}

export async function PUT(request: Request) {
  const member = await getRealMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isSupabaseConfigured() || !safetyConfigured()) return unavailable();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send your details as JSON." }, { status: 400 });
  }
  const parsed = parseSafetyInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { error } = await saveSafety(member.id, parsed.details);
  if (error) return NextResponse.json({ error: "Your details weren't saved. Try again." }, { status: 500 });
  // What changed is never logged, only that it did.
  await audit(member.id, hasSafetyDetails(parsed.details) ? "safety.saved" : "safety.deleted", "member", member.id);
  return NextResponse.json({ ok: true, details: hasSafetyDetails(parsed.details) ? parsed.details : null });
}

export async function DELETE() {
  const member = await getRealMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isSupabaseConfigured()) return unavailable();
  const { error } = await deleteSafety(member.id);
  if (error) return NextResponse.json({ error: "Your details weren't deleted. Try again." }, { status: 500 });
  await audit(member.id, "safety.deleted", "member", member.id);
  return NextResponse.json({ ok: true, details: null });
}
