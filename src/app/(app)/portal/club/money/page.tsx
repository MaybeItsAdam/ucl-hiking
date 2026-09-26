import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MoneyLines } from "@/components/club/MoneyLines";
import { ClubSubnav } from "@/components/ClubSubnav";
import { requireClub } from "@/lib/clubPage";
import { eventDetails } from "@/lib/eventDetails";
import { longDate } from "@/lib/eventList";
import { getEventsInClubYear } from "@/lib/events";
import { pounds, tripMoney, type FinanceLine } from "@/lib/finance";
import { clubYear, clubYearLabel } from "@/lib/hikeMap";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export const metadata: Metadata = { title: "Money | UCL Hiking Club" };

/**
 * Per-trip takings and costs. Ticket income is the SU's numbers (price × sold);
 * the treasurer adds the coach, the hut and anything else.
 */
export default async function MoneyPage() {
  const { principal } = await requireClub();
  if (!principal) redirect("/portal/club");

  const year = clubYear();
  const events = (await getEventsInClubYear(year)).filter((e) => e.suu_event_id && e.status !== "cancelled");
  let lines: FinanceLine[] = [];
  if (isSupabaseConfigured() && events.length) {
    const { data } = await getSupabaseAdmin()
      .from("event_finance_lines")
      .select("id, event_suu_id, kind, label, amount_pence")
      .in("event_suu_id", events.map((e) => e.suu_event_id!))
      .order("created_at");
    lines = (data ?? []) as FinanceLine[];
  }
  // Trips with money attached: paid tickets or a line entered.
  const trips = events
    .map((e) => ({ event: e, money: tripMoney({ suu_event_id: e.suu_event_id!, price_pence: e.price_pence, tickets_sold: e.tickets_sold }, lines) }))
    .filter((t) => t.money.ticketIncome || t.money.lines.length || eventDetails(t.event).kind === "trip");
  const total = trips.reduce((sum, t) => sum + t.money.net, 0);

  return (
    <article className="club-page">
      <ClubSubnav active="money" principal={principal} />
      <div className="money-head">
        <div>
          <p className="event-eyebrow">{clubYearLabel(year)}</p>
          <p className={`money-total${total < 0 ? " is-out" : ""}`}>{pounds(total)}</p>
          <p className="day-note">net across {trips.length} {trips.length === 1 ? "trip" : "trips"}</p>
        </div>
        <a className="kit-btn" href="/api/club/finance/csv" download>
          Download CSV
        </a>
      </div>
      {trips.length ? (
        <ul className="money-trips">
          {trips.map(({ event, money }) => (
            <li key={event.id}>
              <div className="money-trip-head">
                <div>
                  <strong>{eventDetails(event).name}</strong>
                  <span className="event-meta">{event.starts_at ? longDate(event.starts_at) : "Date to be confirmed"}</span>
                </div>
                <strong className={money.net < 0 ? "is-out" : "is-in"}>{pounds(money.net)}</strong>
              </div>
              <p className="day-note">
                SU tickets {pounds(money.ticketIncome)}
                {event.tickets_sold ? ` (${event.tickets_sold} × ${pounds(event.price_pence)})` : ""}
              </p>
              <MoneyLines eventSuuId={event.suu_event_id!} lines={money.lines} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="day-note">No paid trips this year yet. Trips appear here once they sell SU tickets.</p>
      )}
    </article>
  );
}
