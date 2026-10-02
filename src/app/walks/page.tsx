import type { Metadata } from "next";
import Link from "next/link";
import { ClubMark } from "@/components/ClubMark";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { parseNumber, type Values } from "@/lib/walkSheet";

export const metadata: Metadata = {
  title: "Upcoming walks | UCL Hiking Club",
  description: "Walks and hikes from UCL Hiking Club that anyone can come on.",
};

export const revalidate = 600;

const ZONE = "Europe/London";
const fmt = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, weekday: "long", day: "numeric", month: "long" }).format(new Date(`${iso}T12:00:00Z`));

const safeLink = (url: string | undefined) => (url && /^https:\/\/studentsunionucl\.org\//.test(url) ? url : null);

interface PublicWalk {
  id: string;
  starts_on: string;
  title: string;
  sheet_values: Values;
  shown: Values;
}

/** The walks the committee has made public: no sign-in needed. */
export default async function PublicWalksPage() {
  let walks: PublicWalk[] = [];
  if (isSupabaseConfigured()) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date());
    const { data } = await getSupabaseAdmin()
      .from("sheet_walks")
      .select("id, starts_on, title, sheet_values, shown")
      .eq("present", true)
      .eq("published", true)
      .eq("visibility", "public")
      .gte("starts_on", today)
      .order("starts_on", { ascending: true })
      .limit(60);
    walks = ((data ?? []) as PublicWalk[]).filter((w) => !/cancel/i.test(w.shown?.status ?? ""));
  }

  return (
    <main className="privacy-page public-walks">
      <header className="privacy-header">
        <Link href="/" className="privacy-brand" aria-label="UCL Hiking Club home">
          <ClubMark size={42} />
          <span>UCL Hiking Club</span>
        </Link>
        <Link href="/auth/signin" className="privacy-back">Members sign in</Link>
      </header>
      <article className="privacy-content">
        <p className="privacy-eyebrow">Open to everyone</p>
        <h1>Upcoming walks</h1>
        {walks.length ? (
          <ul className="public-walk-list">
            {walks.map((w) => {
              const km = parseNumber(w.sheet_values.distanceKm ?? "") ?? parseNumber(w.shown.distanceShown ?? "");
              const link = safeLink(w.sheet_values.suLink);
              return (
                <li key={w.id}>
                  <span className="event-eyebrow">{fmt(w.starts_on)}</span>
                  <h2>{w.title}</h2>
                  <p className="event-meta">
                    {[km ? `${Math.round(km)} km` : null, w.shown.meetTime ? `Meet ${w.shown.meetTime}` : null, w.shown.meetPlace || null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {link ? (
                    <a className="kit-btn" href={link} target="_blank" rel="noreferrer">
                      Tickets on the SU website
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p>Nothing open to everyone right now. Members see the full programme in the app.</p>
        )}
      </article>
    </main>
  );
}
