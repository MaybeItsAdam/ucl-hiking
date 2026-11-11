import type { Metadata } from "next";
import { ClubSubnav } from "@/components/ClubSubnav";
import { ClubLinks } from "@/components/club/ClubLinks";
import { requireClub } from "@/lib/clubPage";
import { listClubLinks } from "@/lib/clubLinkStore";

export const metadata: Metadata = { title: "Links | UCL Hiking Club" };

/**
 * The club's short links (uclhiking.org/e/…), for posters, QR codes and
 * messages: point one at this term's form and the printed link still works.
 */
export default async function ClubLinksPage() {
  const { principal } = await requireClub();
  const links = await listClubLinks();
  const site = (process.env.NEXT_PUBLIC_APP_URL || "https://uclhiking.org").replace(/\/+$/, "");
  return (
    <article className="club-page">
      <ClubSubnav active="links" principal={principal} />
      <ClubLinks links={links} site={site} />
    </article>
  );
}
