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

/** "Saturday 18 October", and the year too when it is not this one. */
export function longDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const sameYear = part(date, { year: "numeric" }) === part(now, { year: "numeric" });
  return part(date, { weekday: "long", day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) });
}

/** Days since the epoch of the London calendar date, so "tomorrow" means the date, not 24 hours. */
function londonDayNumber(date: Date): number {
  const [y, m, d] = part(date, { year: "numeric", month: "2-digit", day: "2-digit" }).split("/").reverse().map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** "Today", "Tomorrow", "In 5 days", "Happening now", or how long ago it was. */
export function countdown(
  event: Pick<SUEvent, "starts_at" | "ends_at">,
  now = new Date(),
): { label: string; past: boolean } | null {
  if (!event.starts_at) return null;
  const start = new Date(event.starts_at);
  const end = event.ends_at ? new Date(event.ends_at) : null;
  if (end && start <= now && now <= end && londonDayNumber(end) !== londonDayNumber(start)) {
    return { label: "Happening now", past: false };
  }
  const days = londonDayNumber(start) - londonDayNumber(now);
  if (days === 0) return { label: "Today", past: false };
  if (days === 1) return { label: "Tomorrow", past: false };
  if (days > 1) return { label: days < 14 ? `In ${days} days` : `In ${Math.round(days / 7)} weeks`, past: false };
  if (days === -1) return { label: "Yesterday", past: true };
  return { label: -days < 14 ? `${-days} days ago` : -days < 60 ? `${Math.round(-days / 7)} weeks ago` : "Done", past: true };
}

/**
 * One event per trip. Toolbox splits a multi-day SU listing into a row per day
 * ("Club Trip #1" Sun 8 – Wed 11 Nov came through as four 07:00–18:00 rows), so
 * same-titled events on consecutive London days are shown as one spanning them
 * all. The rows stay apart in the database: walk links and attendees hang off
 * each day's id, and the joined event keeps the first day's.
 *
 * Expects start order; another event between the days doesn't break the run.
 */
export function joinMultiDayEvents<T extends SUEvent>(events: T[]): T[] {
  const joined: T[] = [];
  const lastByTitle = new Map<string, T>();
  for (const event of events) {
    const key = event.title.trim();
    const prev = lastByTitle.get(key);
    const prevEnd = prev?.ends_at ?? prev?.starts_at;
    if (prev && prevEnd && event.starts_at && londonDayNumber(new Date(event.starts_at)) - londonDayNumber(new Date(prevEnd)) === 1) {
      prev.ends_at = event.ends_at ?? event.starts_at;
      continue;
    }
    const copy = { ...event };
    joined.push(copy);
    lastByTitle.set(key, copy);
  }
  return joined;
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
