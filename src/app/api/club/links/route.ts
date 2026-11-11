import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getSupabaseAdmin } from "@/lib/supabase";
import { TAKEN, committeeOnly, readLink } from "./input";

/** Make a short link. Committee only. */
export async function POST(request: Request) {
  const { member, refused } = await committeeOnly();
  if (refused) return refused;
  const link = await readLink(request);
  if ("error" in link) return NextResponse.json({ error: link.error }, { status: 400 });

  const { data, error } = await getSupabaseAdmin()
    .from("club_links")
    .insert({ ...link, updated_by: member.id })
    .select("id")
    .single();
  if (error?.code === TAKEN) return NextResponse.json({ error: `${link.path} is already a link: edit that one.` }, { status: 409 });
  if (error) return NextResponse.json({ error: "The link wasn't saved." }, { status: 500 });
  await audit(member.id, "club_link.created", "club_link", String(data.id), link);
  return NextResponse.json({ ok: true, id: data.id });
}
