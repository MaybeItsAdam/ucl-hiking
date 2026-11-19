import { NextResponse } from "next/server";
import { profileOf } from "@/lib/access";
import { audit } from "@/lib/audit";
import { getEvent } from "@/lib/events";
import { isMissingAlbums, saveAlbum } from "@/lib/photoAlbumStore";
import { canManageAlbums, normalizeAlbumUrl } from "@/lib/photoAlbums";
import { getCurrentMember } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase";

type Params = { params: Promise<{ id: string }> };

/**
 * PUT /api/events/:id/album `{ url }` — attach a Google Photos shared-album
 * link to a trip, replace it, or remove it with an empty url. Committee only.
 * Who is then shown it is decided on the photo archive (lib/photoAlbums).
 */
export async function PUT(request: Request, { params }: Params) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!canManageAlbums(profileOf(member))) {
    return NextResponse.json({ error: "Only the committee add photo albums to trips." }, { status: 403 });
  }
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Albums need the database." }, { status: 503 });

  const event = await getEvent((await params).id);
  if (!event?.suu_event_id) return NextResponse.json({ error: "No such event." }, { status: 404 });

  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send the link as JSON." }, { status: 400 });
  }
  const parsed = normalizeAlbumUrl(body?.url);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { error } = await saveAlbum(event.suu_event_id, parsed.url, member.id);
  if (error) {
    if (isMissingAlbums(error)) {
      return NextResponse.json({ error: "Albums can't be added until the database is updated." }, { status: 503 });
    }
    return NextResponse.json({ error: "The album wasn't saved. Try again." }, { status: 500 });
  }
  await audit(member.id, parsed.url ? "event.album_set" : "event.album_removed", "event", event.suu_event_id, parsed.url ? { url: parsed.url } : {});
  return NextResponse.json({ ok: true, url: parsed.url });
}
