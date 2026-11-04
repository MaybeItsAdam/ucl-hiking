import type { SUEvent } from "@/lib/types";

/** How many tickets a walk has sold, out of how many, and how old that is. */
export interface TicketCount {
  bought: number;
  /** The SU listing's stock; null when it's unknown. */
  released: number | null;
  asOf: string;
}

/**
 * A walk's ticket count for its leaders, from the freshest source there is.
 *
 * Toolbox's SU ticket sales give both numbers and arrive with the daily event
 * sync. The ticketholder register (re-sent by a principal's Connector every
 * 30 minutes while it's open) only gives the bought side, but is usually
 * newer, so it wins when it is. Counts from before `tickets_synced_at`
 * existed came from the retired scraper and are never shown as current.
 */
export function ticketCount(
  event: Pick<SUEvent, "tickets_sold" | "capacity" | "tickets_synced_at">,
  register: { count: number; syncedAt: string } | null,
): TicketCount | null {
  const released = event.capacity > 0 ? event.capacity : null;
  const sales = event.tickets_synced_at ? { bought: event.tickets_sold, released, asOf: event.tickets_synced_at } : null;
  if (register && (!sales || Date.parse(register.syncedAt) > Date.parse(sales.asOf))) {
    return { bought: register.count, released, asOf: register.syncedAt };
  }
  return sales;
}
