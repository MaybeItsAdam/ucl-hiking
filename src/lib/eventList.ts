import type { SUEvent } from "@/lib/types";

// The club is in London, and a server in another zone must still say "Sat 4".
const ZONE = "Europe/London";

const part = (date: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, ...options }).format(date);

const time = (date: Date) => part(date, { hour: "2-digit", minute: "2-digit", hour12: false });

export interface EventListItem {
  event: SUEvent;
  weekday: string;
  day: string;
  when: string;
}

export interface EventMonth {
  key: string;
  label: string;
  items: EventListItem[];
}

/** "09:00–17:00", "All day", or a span such as "Sat 4 Oct – Sun 5 Oct" for a weekend away. */
export function eventWhen(event: Pick<SUEvent, "starts_at" | "ends_at" | "is_all_day">): string {
  if (!event.starts_at) return "Time to be confirmed";
  const start = new Date(event.starts_at);
  const end = event.ends_at ? new Date(event.ends_at) : null;
  const dayKey = (d: Date) => part(d, { year: "numeric", month: "2-digit", day: "2-digit" });
  const longDay = (d: Date) => part(d, { weekday: "short", day: "numeric", month: "short" });

  if (end && dayKey(end) !== dayKey(start)) {
    return event.is_all_day
      ? `${longDay(start)} – ${longDay(end)}`
      : `${longDay(start)}, ${time(start)} – ${longDay(end)}, ${time(end)}`;
  }
  if (event.is_all_day) return "All day";
  return end && end > start ? `${time(start)}–${time(end)}` : time(start);
}

/** Events in start order, grouped under a heading per month. */
export function groupEventsByMonth(events: SUEvent[]): EventMonth[] {
  const months: EventMonth[] = [];
  for (const event of events) {
    if (!event.starts_at) continue;
    const start = new Date(event.starts_at);
    const key = part(start, { year: "numeric", month: "2-digit" });
    let month = months.at(-1);
    if (!month || month.key !== key) {
      month = { key, label: part(start, { month: "long", year: "numeric" }), items: [] };
      months.push(month);
    }
    month.items.push({
      event,
      weekday: part(start, { weekday: "short" }),
      day: part(start, { day: "numeric" }),
      when: eventWhen(event),
    });
  }
  return months;
}
