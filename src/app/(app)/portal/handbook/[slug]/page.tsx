import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Markdown } from "@/components/club/Markdown";
import { profileOf } from "@/lib/access";
import { readableVisibilities } from "@/lib/handbook";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export const metadata: Metadata = { title: "Handbook | UCL Hiking Club" };

export default async function MemberHandbookDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const { slug } = await params;
  const readable = readableVisibilities(profileOf(member));
  if (!readable) redirect(`/portal/club/handbook/${slug}`);
  if (!isSupabaseConfigured() || !/^[a-z0-9-]{1,60}$/.test(slug)) notFound();
  // A page not shared with them is the same as no page at all.
  const { data: doc } = await getSupabaseAdmin()
    .from("club_docs")
    .select("title, body")
    .eq("slug", slug)
    .in("visibility", readable)
    .maybeSingle();
  if (!doc) notFound();
  return (
    <article className="event-page">
      <Link href="/portal/handbook" className="event-back">
        <ChevronLeft size={18} aria-hidden="true" />
        Handbook
      </Link>
      <header className="day-head">
        <span className="event-eyebrow">Club handbook</span>
        <h2>{doc.title}</h2>
      </header>
      {doc.body.trim() ? <Markdown source={doc.body} /> : <p className="day-note">Nothing here yet.</p>}
    </article>
  );
}
