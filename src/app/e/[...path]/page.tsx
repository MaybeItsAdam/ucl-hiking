import { serveClubLink } from "@/lib/serveClubLink";

export const dynamic = "force-dynamic";

/** /e/… short links, which the committee edits under Club → Links. */
export default async function ClubLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return serveClubLink("e", (await params).path, await searchParams);
}
