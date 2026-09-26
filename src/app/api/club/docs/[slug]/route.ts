import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { audit } from "@/lib/audit";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

type Params = { params: Promise<{ slug: string }> };

const SLUG = /^[a-z0-9-]{1,60}$/;

/** Save a handbook page, creating it if the slug is new. */
export async function PUT(request: Request, { params }: Params) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!can(profileOf(member), "manage_club")) return NextResponse.json({ error: "Committee only." }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "The handbook needs the database." }, { status: 503 });
  const { slug } = await params;
  if (!SLUG.test(slug)) return NextResponse.json({ error: "That page name won't work." }, { status: 400 });

  let body: { title?: unknown; body?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send it as JSON." }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  const text = typeof body.body === "string" ? body.body.slice(0, 50_000) : "";
  if (!title) return NextResponse.json({ error: "Give the page a title." }, { status: 400 });

  const { error } = await getSupabaseAdmin()
    .from("club_docs")
    .upsert({ slug, title, body: text, updated_by: member.id }, { onConflict: "slug" });
  if (error) return NextResponse.json({ error: "The page wasn't saved." }, { status: 500 });
  await audit(member.id, "handbook.saved", "club_doc", slug, { title, length: text.length });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (member.governance_role !== "principal" && member.governance_role !== "admin") {
    return NextResponse.json({ error: "Only principals delete handbook pages." }, { status: 403 });
  }
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "The handbook needs the database." }, { status: 503 });
  const { slug } = await params;
  const { error } = await getSupabaseAdmin().from("club_docs").delete().eq("slug", slug);
  if (error) return NextResponse.json({ error: "The page wasn't deleted." }, { status: 500 });
  await audit(member.id, "handbook.deleted", "club_doc", slug);
  return NextResponse.json({ ok: true });
}
