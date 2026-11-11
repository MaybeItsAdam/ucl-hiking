import { serveClubLink } from "@/lib/serveClubLink";

export const dynamic = "force-dynamic";

/** /media/… short links, which the committee edits under Club → Links. */
export default async function ClubLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return serveClubLink("media", (await params).path, await searchParams);
}
