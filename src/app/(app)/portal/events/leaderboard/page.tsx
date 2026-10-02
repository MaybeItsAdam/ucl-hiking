import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EventsSubnav } from "@/components/EventsSubnav";
import { can, profileOf } from "@/lib/access";
import { formatKm } from "@/lib/eventDetails";
import { a1, readValues } from "@/lib/googleSheets";
import { clubYear, clubYearLabel } from "@/lib/hikeMap";
import { leaderboard, type BoardWalk } from "@/lib/leaderboard";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { nameKey, readRoster, TABS, WALK_SHEETS, type RosterEntry } from "@/lib/walkSheet";

export const metadata: Metadata = { title: "Walk leaders | UCL Hiking Club" };

/**
 * Walks led and distance walked, per walk leader, from the committee
 * calendar: this club year or all of it. For walk leaders and the committee.
 */
export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const profile = profileOf(member);
  if (!can(profile, "lead_walks")) redirect("/portal/events");

  const all = (await searchParams).all === "1";
  const year = clubYear();
  let walks: BoardWalk[] = [];
  let roster: RosterEntry[] = [];
  let myName: string | null = null;

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseAdmin();
    let query = supabase.from("sheet_walks").select("starts_on, title, sheet_values, shown").eq("present", true).limit(5000);
    if (!all) query = query.gte("starts_on", `${year}-09-01`).lte("starts_on", `${year + 1}-08-31`);
    const [{ data }, rosterRows, me] = await Promise.all([
      query,
      readValues(WALK_SHEETS.leaders, a1(TABS.roster, "A1:G")).catch(() => [] as string[][]),
      supabase.from("members").select("wl_name").eq("id", member.id).maybeSingle(),
    ]);
    walks = (data ?? []) as BoardWalk[];
    roster = readRoster(rosterRows);
    myName = (me.data?.wl_name as string | null | undefined) ?? null;
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const rows = leaderboard(walks, roster, today);
  const mine = myName ? nameKey(myName) : null;
  const totalWalks = rows.reduce((n, r) => n + r.walks, 0);

  return (
    <article className="events-page leaderboard-page">
      <EventsSubnav active="leaderboard" showRota showProgramme={can(profile, "manage_walks")} />
      <div className="programme-filters" role="group" aria-label="Period">
        <Link href="/portal/events/leaderboard" className={all ? undefined : "active"}>
          {clubYearLabel(year)}
        </Link>
        <Link href="/portal/events/leaderboard?all=1" className={all ? "active" : undefined}>
          All time
        </Link>
      </div>

      {rows.length ? (
        <>
          <p className="event-meta">
            {totalWalks} leader-walks from the committee calendar. A walk counts once it&apos;s happened; shadowing is counted apart.
          </p>
          <ol className="leaderboard">
            <li className="leaderboard-head" aria-hidden="true">
              <span>#</span>
              <span>Leader</span>
              <span>Walks</span>
              <span>Distance</span>
            </li>
            {rows.map((r, i) => (
              <li key={r.key} className={mine && nameKey(r.name) === mine ? "is-me" : undefined}>
                <span className="leaderboard-rank">{r.walks ? i + 1 : "–"}</span>
                <span className="leaderboard-name">
                  {r.name}
                  {r.shadowed ? <small>{r.shadowed} shadowed</small> : null}
                </span>
                <span className="leaderboard-num">{r.walks}</span>
                <span className="leaderboard-num">{formatKm(Math.round(r.km))}</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="day-note">No walks led {all ? "yet" : "this year yet"}. The board fills in from the committee calendar after each walk.</p>
      )}
    </article>
  );
}
