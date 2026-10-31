import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { SU_MEMBERSHIP_URL } from "@/lib/toolbox";
import type { SUEvent } from "@/lib/types";

/**
 * Where to buy a ticket for an event, and what to call the button.
 *
 * The SU's event pages are addressed by a slug of the listing's title
 * (`/whats-on/clubs-societies/club-trip-5-romania`), not by any id we hold:
 * Toolbox sends neither the page's URL nor its slug, and `suu_event_id` is
 * Toolbox's own key. So the link is never built, only taken from where a person
 * put it: the leader's plan, then the committee sheet's "SU event link" column
 * on the walk linked to this event. Failing both, the club's SU page, which
 * lists its events, under a label that doesn't promise this one.
 */
export interface Booking {
  href: string;
  label: string;
  /** False when it is only the club's page, not this event's own. */
  specific: boolean;
  soldOut: boolean;
}

const SU_HOST = /(^|\.)studentsunionucl\.org$/i;

/** An https link to the SU's own site, or null. */
export function suUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && SU_HOST.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

const londonDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });

/** Over once its end has passed; with no end, once its London day has. */
export function isOver(event: Pick<SUEvent, "status" | "starts_at" | "ends_at">, now = new Date()): boolean {
  if (event.status === "completed") return true;
  if (event.ends_at) return new Date(event.ends_at) < now;
  if (event.starts_at) return londonDay.format(new Date(event.starts_at)) < londonDay.format(now);
  return false;
}

/**
 * The booking button for this event, or null when there is nothing to book:
 * cancelled, already over, or a draft the SU hasn't put on sale.
 */
export function bookingFor(
  event: Pick<SUEvent, "status" | "starts_at" | "ends_at">,
  links: { plan?: string | null; sheet?: string | null },
  now = new Date(),
): Booking | null {
  if (event.status === "cancelled" || event.status === "draft" || isOver(event, now)) return null;
  const soldOut = event.status === "sold_out";
  // A leader may point at somewhere other than the SU (a form, say): say so only when it is the SU.
  if (links.plan) return { href: links.plan, label: suUrl(links.plan) ? "Book on the SU" : "Book a place", specific: true, soldOut };
  const sheet = suUrl(links.sheet);
  if (sheet) return { href: sheet, label: "Book on the SU", specific: true, soldOut };
  return { href: SU_MEMBERSHIP_URL, label: "Tickets on the SU", specific: false, soldOut };
}

/** The committee sheet's "SU event link" for the walk linked to this event, if it has one. */
export async function getSheetSuLink(suuId: string | null): Promise<string | null> {
  if (!suuId || !isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("sheet_walks")
    .select("sheet_values")
    .eq("present", true)
    .eq("event_suu_id", suuId)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const values = data.sheet_values as Record<string, string | undefined> | null;
  return suUrl(values?.suLink);
}
