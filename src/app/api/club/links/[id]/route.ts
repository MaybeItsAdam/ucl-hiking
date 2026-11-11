import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getSupabaseAdmin } from "@/lib/supabase";
import { TAKEN, committeeOnly, readLink } from "../input";

type Params = { params: Promise<{ id: string }> };

async function linkId(params: Params["params"]): Promise<number | null> {
  const id = Number((await params).id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Repoint, rename or annotate a short link. Committee only. */
export async function PUT(request: Request, { params }: Params) {
  const { member, refused } = await committeeOnly();
  if (refused) return refused;
  const id = await linkId(params);
  if (!id) return NextResponse.json({ error: "No such link." }, { status: 404 });
  const link = await readLink(request);
  if ("error" in link) return NextResponse.json({ error: link.error }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: before } = await supabase.from("club_links").select("path, destination").eq("id", id).maybeSingle();
  if (!before) return NextResponse.json({ error: "No such link." }, { status: 404 });
  const { error } = await supabase.from("club_links").update({ ...link, updated_by: member.id }).eq("id", id);
  if (error?.code === TAKEN) return NextResponse.json({ error: `${link.path} is already a link.` }, { status: 409 });
  if (error) return NextResponse.json({ error: "The link wasn't saved." }, { status: 500 });
  await audit(member.id, "club_link.updated", "club_link", String(id), { before, after: link });
  return NextResponse.json({ ok: true });
}

/** Remove a short link: anyone following it afterwards gets the site's 404. Committee only. */
export async function DELETE(_request: Request, { params }: Params) {
  const { member, refused } = await committeeOnly();
  if (refused) return refused;
  const id = await linkId(params);
  if (!id) return NextResponse.json({ error: "No such link." }, { status: 404 });
  const { data, error } = await getSupabaseAdmin().from("club_links").delete().eq("id", id).select("path, destination").maybeSingle();
  if (error) return NextResponse.json({ error: "The link wasn't deleted." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No such link." }, { status: 404 });
  await audit(member.id, "club_link.deleted", "club_link", String(id), data);
  return NextResponse.json({ ok: true });
}
