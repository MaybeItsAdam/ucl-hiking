import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { profileOf } from "@/lib/access";
import { readableVisibilities } from "@/lib/handbook";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export const metadata: Metadata = { title: "Handbook | UCL Hiking Club" };

/** The handbook pages the committee have shared with members or walk leaders. Read only. */
export default async function MemberHandbookPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const readable = readableVisibilities(profileOf(member));
  // The committee read and edit the whole handbook from Club.
  if (!readable) redirect("/portal/club/handbook");
  let docs: { slug: string; title: string }[] = [];
  if (isSupabaseConfigured()) {
    const { data } = await getSupabaseAdmin().from("club_docs").select("slug, title").in("visibility", readable).order("title");
    docs = data ?? [];
  }
  return (
    <article className="club-page">
      {docs.length ? (
        <ul className="kit-list handbook-list">
          {docs.map((doc) => (
            <li key={doc.slug}>
              <Link href={`/portal/handbook/${doc.slug}`}>
                <span>
                  <strong>{doc.title}</strong>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="day-note">Nothing has been shared with you yet.</p>
      )}
    </article>
  );
}
