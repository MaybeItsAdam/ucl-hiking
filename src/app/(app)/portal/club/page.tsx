import type { Metadata } from "next";
import { ClubSubnav } from "@/components/ClubSubnav";
import { clubStats, type StatsAttendee, type TierChange } from "@/lib/clubStats";
import { requireClub } from "@/lib/clubPage";
import { getEventPlans } from "@/lib/eventPlans";
import { getEventsInClubYear } from "@/lib/events";
import { clubYear, clubYearLabel } from "@/lib/hikeMap";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export const metadata: Metadata = { title: "Club stats | UCL Hiking Club" };

const percent = (value: number | null) => (value === null ? "–" : `${Math.round(value * 100)}%`);

/** The year so far, for the committee and for the SU's re-affiliation questions. */
export default async function ClubStatsPage() {
  const { principal } = await requireClub();
  const year = clubYear();
  const events = await getEventsInClubYear(year);
  const ids = events.map((e) => e.suu_event_id).filter((id): id is string => Boolean(id));

  let attendees: StatsAttendee[] = [];
  let tierChanges: TierChange[] = [];
  if (isSupabaseConfigured() && ids.length) {
    const supabase = getSupabaseAdmin();
    const from = `${year}-08-31T23:00:00Z`;
    const [a, t] = await Promise.all([
      supabase.from("event_attendees").select("event_suu_id, member_id, name, removed, checked_in_at").in("event_suu_id", ids),
      supabase.from("member_tier_history").select("member_id, from_tier, to_tier, changed_at").gte("changed_at", from),
    ]);
    attendees = (a.data ?? []) as StatsAttendee[];
    tierChanges = (t.data ?? []) as TierChange[];
  }
  const plans = await getEventPlans(ids);
  const leaders = [...plans.values()].map((p) => ({
    event_suu_id: p.event_suu_id,
    leader_member_id: p.leader_member_id,
    leader_name: p.leader?.full_name ?? null,
  }));
  const stats = clubStats(events, attendees, leaders, tierChanges);
  const peak = Math.max(1, ...stats.byMonth.map((m) => m.walkers));
  const anyWalkers = stats.byMonth.some((m) => m.walkers);

  return (
    <article className="club-page">
      <ClubSubnav active="stats" principal={principal} />
      <p className="event-eyebrow">{clubYearLabel(year)} so far</p>

      <dl className="event-stats club-tiles">
        <Tile label="Walks run" value={String(stats.walksRun)} note={stats.walksUpcoming ? `${stats.walksUpcoming} to come` : undefined} />
        <Tile label="Walkers" value={String(stats.uniqueWalkers)} note="different people" />
        <Tile label="Came back" value={percent(stats.repeatRate)} note="walked twice or more" />
        <Tile label="Walks full" value={percent(stats.averageFill)} note="SU tickets sold" />
        <Tile label="No-shows" value={percent(stats.noShowRate)} note="on registers used" />
        <Tile
          label="Tasters joined"
          value={stats.tasters ? `${stats.tastersConverted} of ${stats.tasters}` : "–"}
          note="went Standard or Explorer"
        />
      </dl>

      <section className="event-section" aria-labelledby="club-months">
        <h3 id="club-months" className="event-section-title">
          Walkers each month
        </h3>
        {anyWalkers ? (
          <>
            <div className="club-bars" role="img" aria-label="Walkers each month, September to August; the table below has the numbers">
              {stats.byMonth.map((m) => (
                <div key={m.label} className="club-bar" title={`${m.label}: ${m.walkers} walkers on ${m.walks} ${m.walks === 1 ? "walk" : "walks"}`}>
                  <span className="club-bar-value">{m.walkers || ""}</span>
                  <span className="club-bar-fill" style={{ height: `${(m.walkers / peak) * 100}%` }} />
                  <span className="club-bar-label">{m.label}</span>
                </div>
              ))}
            </div>
            <details className="event-more">
              <summary>As a table</summary>
              <table className="club-table">
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col">Walks</th>
                    <th scope="col">Walkers</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byMonth.map((m) => (
                    <tr key={m.label}>
                      <th scope="row">{m.label}</th>
                      <td>{m.walks}</td>
                      <td>{m.walkers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        ) : (
          <p className="day-note">Fills in once walks have registers, from Toolbox ticket holders or leaders checking people in.</p>
        )}
      </section>

      {stats.topLeaders.length ? (
        <section className="event-section" aria-labelledby="club-leaders">
          <h3 id="club-leaders" className="event-section-title">
            Most walks led
          </h3>
          <ol className="club-leaders">
            {stats.topLeaders.map((l) => (
              <li key={l.memberId}>
                <span>{l.name}</span>
                <strong>{l.walks}</strong>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </article>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note ? <dd className="club-tile-note">{note}</dd> : null}
    </div>
  );
}
