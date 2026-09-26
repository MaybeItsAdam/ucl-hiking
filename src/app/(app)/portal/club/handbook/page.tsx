import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ClubSubnav } from "@/components/ClubSubnav";
import { HandbookEditor } from "@/components/club/HandbookEditor";
import { requireClub } from "@/lib/clubPage";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export const metadata: Metadata = { title: "Handbook | UCL Hiking Club" };

const updated = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" });

/** What each committee needs to hand the next: risk assessments, contacts, how things are done. */
export default async function HandbookPage() {
  const { principal } = await requireClub();
  let docs: { slug: string; title: string; body: string; updated_at: string }[] = [];
  if (isSupabaseConfigured()) {
    const { data } = await getSupabaseAdmin().from("club_docs").select("slug, title, body, updated_at").order("title");
    docs = data ?? [];
  }
  return (
    <article className="club-page">
      <ClubSubnav active="handbook" principal={principal} />
      {docs.length ? (
        <ul className="kit-list handbook-list">
          {docs.map((doc) => (
            <li key={doc.slug}>
              <Link href={`/portal/club/handbook/${doc.slug}`}>
                <span>
                  <strong>{doc.title}</strong>
                  <small>{doc.body.trim() ? `Updated ${updated.format(new Date(doc.updated_at))}` : "Empty: write it"}</small>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <section className="event-section" aria-labelledby="handbook-new">
        <h3 id="handbook-new" className="event-section-title">
          New page
        </h3>
        <HandbookEditor slug={null} title="" body="" canDelete={false} />
      </section>
    </article>
  );
}
