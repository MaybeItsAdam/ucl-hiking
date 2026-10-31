import { NextResponse } from "next/server";
import { profileOf } from "@/lib/access";
import { canSeeRoutes } from "@/lib/routeCatalogue";
import { setClubRoute } from "@/lib/routeLibrary";
import { getCurrentMember } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

/** Marks a route as a club route (PUT) or unmarks it (DELETE). Committee only. */
async function mark(id: string, club: boolean) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!canSeeRoutes(profileOf(member))) return NextResponse.json({ error: "Only committee mark club routes." }, { status: 403 });
  const ok = await setClubRoute(id, club, member.email);
  if (!ok) return NextResponse.json({ error: "No such route." }, { status: 404 });
  return NextResponse.json({ club });
}

export async function PUT(_request: Request, { params }: Params) {
  return mark((await params).id, true);
}

export async function DELETE(_request: Request, { params }: Params) {
  return mark((await params).id, false);
}
