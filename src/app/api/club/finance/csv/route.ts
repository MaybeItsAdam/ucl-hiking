import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { eventDetails } from "@/lib/eventDetails";
import { getEventsInClubYear } from "@/lib/events";
import { moneyCsv, tripMoney, type FinanceLine } from "@/lib/finance";
import { clubYear, clubYearLabel } from "@/lib/hikeMap";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { londonDay } from "@/lib/weather";

/** This club year's trip money, for the treasurer's spreadsheet. */
export async function GET() {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!can(profileOf(member), "manage_money")) return NextResponse.json({ error: "Only principals see club money." }, { status: 403 });

  const year = clubYear();
  const events = (await getEventsInClubYear(year)).filter((e) => e.suu_event_id && e.status !== "cancelled");
  let lines: FinanceLine[] = [];
  if (isSupabaseConfigured() && events.length) {
    const { data } = await getSupabaseAdmin()
      .from("event_finance_lines")
      .select("id, event_suu_id, kind, label, amount_pence")
      .in("event_suu_id", events.map((e) => e.suu_event_id!));
    lines = (data ?? []) as FinanceLine[];
  }
  const trips = events
    .map((e) => ({
      ...tripMoney({ suu_event_id: e.suu_event_id!, price_pence: e.price_pence, tickets_sold: e.tickets_sold }, lines),
      name: eventDetails(e).name,
      date: e.starts_at ? londonDay(e.starts_at) : "",
    }))
    .filter((t) => t.ticketIncome || t.lines.length);

  return new NextResponse(moneyCsv(trips), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hiking-money-${clubYearLabel(year).replace("–", "-")}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
