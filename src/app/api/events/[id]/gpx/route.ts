import { NextResponse } from "next/server";
import { profileOf } from "@/lib/access";
import { audit } from "@/lib/audit";
import { eventDetails } from "@/lib/eventDetails";
import { canEditPlan } from "@/lib/eventPlans";
import { deleteEventRoute, getEventRoute, routeFileName, saveEventRoute } from "@/lib/eventRoutes";
import { getEvent } from "@/lib/events";
import { GPX_MAX_BYTES, prepareRoute, toGpx } from "@/lib/gpx";
import { fetchGpx, GpxFetchError } from "@/lib/gpxFetch";
import { getCurrentMember } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase";

type Params = { params: Promise<{ id: string }> };

/** The walk's route as a .gpx file, for OS Maps, Komoot or a watch. Any signed-in member. */
export async function GET(_request: Request, { params }: Params) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const event = await getEvent((await params).id);
  if (!event) return NextResponse.json({ error: "No such event." }, { status: 404 });
  const route = await getEventRoute(event.suu_event_id);
  if (!route) return NextResponse.json({ error: "This walk has no GPX route." }, { status: 404 });

  const title = eventDetails(event).name;
  return new NextResponse(toGpx(route, title), {
    headers: {
      "Content-Type": "application/gpx+xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${routeFileName(title)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

async function editableEvent(params: Params["params"]) {
  const member = await getCurrentMember();
  if (!member) return { error: NextResponse.json({ error: "Sign in first." }, { status: 401 }) };
  if (!canEditPlan(profileOf(member))) {
    return { error: NextResponse.json({ error: "Only walk leaders and committee attach routes." }, { status: 403 }) };
  }
  if (!isSupabaseConfigured()) return { error: NextResponse.json({ error: "Routes need the database." }, { status: 503 }) };
  const event = await getEvent((await params).id);
  if (!event?.suu_event_id) return { error: NextResponse.json({ error: "No such event." }, { status: 404 }) };
  return { member, event, suuId: event.suu_event_id };
}

/**
 * Attach a route: either a multipart upload with a `file`, or JSON `{ url }`
 * for a direct GPX link the server fetches. Replaces any route already there.
 */
export async function POST(request: Request, { params }: Params) {
  const ctx = await editableEvent(params);
  if ("error" in ctx) return ctx.error;

  let text: string;
  let source: { file?: string; url?: string };
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.startsWith("multipart/form-data")) {
      const declared = Number(request.headers.get("content-length"));
      if (declared > GPX_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: "That file is over 4 MB." }, { status: 413 });
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "Choose a .gpx file." }, { status: 400 });
      if (file.size > GPX_MAX_BYTES) return NextResponse.json({ error: "That file is over 4 MB." }, { status: 413 });
      text = await file.text();
      source = { file: file.name.slice(0, 200) || "route.gpx" };
    } else {
      const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
      if (typeof body?.url !== "string" || !body.url.trim()) return NextResponse.json({ error: "Paste a GPX link." }, { status: 400 });
      text = await fetchGpx(body.url);
      source = { url: body.url.trim().slice(0, 1000) };
    }
  } catch (e) {
    const message = e instanceof GpxFetchError ? e.message : "That route couldn't be read.";
    return NextResponse.json({ error: message }, { status: 422 });
  }

  let route;
  try {
    route = prepareRoute(text);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "That GPX file couldn't be read." }, { status: 422 });
  }

  const { data, error } = await saveEventRoute(ctx.suuId, route, source, ctx.member.id);
  if (error) return NextResponse.json({ error: "The route wasn't saved. Try again." }, { status: 500 });
  await audit(ctx.member.id, "event.route_attached", "event", ctx.suuId, {
    ...source,
    distance_m: route.summary.distanceM,
    points: route.segments.reduce((n, s) => n + s.length, 0),
  });
  return NextResponse.json({ ok: true, route: data });
}

export async function DELETE(_request: Request, { params }: Params) {
  const ctx = await editableEvent(params);
  if ("error" in ctx) return ctx.error;
  const { error } = await deleteEventRoute(ctx.suuId);
  if (error) return NextResponse.json({ error: "The route wasn't removed. Try again." }, { status: 500 });
  await audit(ctx.member.id, "event.route_removed", "event", ctx.suuId);
  return NextResponse.json({ ok: true });
}
