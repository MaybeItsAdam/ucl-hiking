import { NextResponse } from "next/server";
import { profileOf } from "@/lib/access";
import { canSeeLibraryRoute, libraryGpx } from "@/lib/routeCatalogue";
import { getLibraryRoute } from "@/lib/routeLibrary";
import { getCurrentMember } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

/**
 * A route from the club's OS Maps library as a .gpx file: committee only. To
 * anyone else it doesn't exist.
 */
export async function GET(_request: Request, { params }: Params) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const route = await getLibraryRoute((await params).id);
  if (!route || !canSeeLibraryRoute(route, profileOf(member))) {
    return NextResponse.json({ error: "No such route." }, { status: 404 });
  }
  if (!route.segments?.length) return NextResponse.json({ error: "This route has no track." }, { status: 404 });

  const { body, filename } = libraryGpx(route);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/gpx+xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
