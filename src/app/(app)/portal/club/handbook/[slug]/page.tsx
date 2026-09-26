import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { HandbookEditor } from "@/components/club/HandbookEditor";
import { Markdown } from "@/components/club/Markdown";
import { requireClub } from "@/lib/clubPage";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export const metadata: Metadata = { title: "Handbook | UCL Hiking Club" };

export default async function HandbookDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { principal } = await requireClub();
  const { slug } = await params;
  if (!isSupabaseConfigured() || !/^[a-z0-9-]{1,60}$/.test(slug)) notFound();
  const { data: doc } = await getSupabaseAdmin().from("club_docs").select("slug, title, body").eq("slug", slug).maybeSingle();
  if (!doc) notFound();
  return (
    <article className="event-page">
      <Link href="/portal/club/handbook" className="event-back">
        <ChevronLeft size={18} aria-hidden="true" />
        Handbook
      </Link>
      <header className="day-head">
        <span className="event-eyebrow">Committee handbook</span>
        <h2>{doc.title}</h2>
      </header>
      {doc.body.trim() ? <Markdown source={doc.body} /> : <p className="day-note">Nothing here yet.</p>}
      <HandbookEditor slug={doc.slug} title={doc.title} body={doc.body} canDelete={principal} />
    </article>
  );
}
