import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EventsSubnav } from "@/components/EventsSubnav";
import { RotaBoard, type RotaWalk } from "@/components/RotaBoard";
import { can, profileOf } from "@/lib/access";
import { eventDetails } from "@/lib/eventDetails";
import { eventWhen, longDate } from "@/lib/eventList";
import { getUpcomingEvents } from "@/lib/events";
import { ROTA_FIELDS, ROTA_SLOTS, rotaWalks, type RotaField } from "@/lib/rota";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { isWalkKind, parseLeaderCell } from "@/lib/walkSheet";
import { pullIfStale, type StoredWalk } from "@/lib/walkSheetSync";
import type { EventKind } from "@/lib/eventDetails";
import type { SUEvent } from "@/lib/types";

export const metadata: Metadata = { title: "Leader rota | UCL Hiking Club" };
export const maxDuration = 60;

const ZONE = "Europe/London";
const DAYS = 60;
const londonDate = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, ...options }).format(new Date(iso));
const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date(iso));

/** London dates from today to DAYS ahead. */
function rotaWindow(now = new Date()) {
  return { today: dayOf(now.toISOString()), until: dayOf(new Date(now.getTime() + DAYS * 86_400_000).toISOString()) };
}

type RotaRow = Pick<StoredWalk, "id" | "starts_on" | "title" | "kind" | "sheet_values" | "conflicts" | "event_suu_id" | "synced_at">;

/** Who's down for a walk, for its row in the list. */
function summary(values: Record<string, string>) {
  const slots = ROTA_SLOTS.map((k) => parseLeaderCell(values[k] ?? "")[0]?.name ?? (values[k] ?? "").trim()).filter(Boolean);
  return {
    leaders: slots,
    extra: parseLeaderCell(values.extraLeaders ?? "").length,
    shadowing: parseLeaderCell(values.shadowing ?? "").length,
  };
}

/**
 * The walk leader rota is the WL calendar: each walk in the next two months
 * with its six walk leader slots, additional leaders and shadowing WLs, read
 * from the sheet (pulled when it's a few minutes old) and written back to it.
 */
export default async function RotaPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const profile = profileOf(member);
  if (!can(profile, "lead_walks")) redirect("/portal/events");
  const canAssign = can(profile, "manage_walks");

  const { today, until } = rotaWindow();
  const [, upcoming] = await Promise.all([isSupabaseConfigured() ? pullIfStale() : null, getUpcomingEvents()]);
  const suWalks = rotaWalks(upcoming, DAYS);
  const bySuu = new Map(upcoming.filter((e) => e.suu_event_id).map((e) => [e.suu_event_id!, e]));

  let rows: RotaRow[] = [];
  if (isSupabaseConfigured()) {
    const { data } = await getSupabaseAdmin()
      .from("sheet_walks")
      .select("id, starts_on, title, kind, sheet_values, conflicts, event_suu_id, synced_at")
      .eq("present", true)
      .gte("starts_on", today)
      .lte("starts_on", until)
      .order("starts_on", { ascending: true })
      .order("sheet_row", { ascending: true });
    rows = (data ?? []) as RotaRow[];
  }

  const month = (iso: string) => londonDate(iso, { month: "long", year: "numeric" });
  const fromSheet: (RotaWalk & { sortKey: string })[] = rows
    .filter((w) => w.starts_on && isWalkKind(w.kind as EventKind))
    .map((w) => {
      const event = w.event_suu_id ? bySuu.get(w.event_suu_id) : undefined;
      const noon = `${w.starts_on}T12:00:00Z`;
      const values: Record<RotaField, string> = Object.fromEntries(ROTA_FIELDS.map((k) => [k, w.sheet_values?.[k] ?? ""])) as Record<RotaField, string>;
      const conflicts: RotaWalk["conflicts"] = {};
      for (const k of ROTA_FIELDS) {
        const c = w.conflicts?.[k];
        if (c) conflicts[k] = { sheet: c.sheet, app: c.app };
      }
      return {
        sortKey: event?.starts_at ?? noon,
        key: w.id,
        walkId: w.id,
        eventId: event?.id ?? null,
        name: w.title,
        when: event?.starts_at ? `${longDate(event.starts_at)} · ${eventWhen(event)}` : longDate(noon),
        weekday: londonDate(noon, { weekday: "short" }),
        day: londonDate(noon, { day: "numeric" }),
        month: month(noon),
        // Only cells the WL calendar has (a row on its sign-up tab, not a formula) come back in sheet_values.
        editable: ROTA_FIELDS.every((k) => w.sheet_values && k in w.sheet_values),
        values,
        conflicts,
        version: w.synced_at,
        ...summary(values),
      };
    });

  // SU walks the WL calendar doesn't have a row for: listed, so nothing goes missing, but read-only.
  const linked = new Set(rows.map((w) => w.event_suu_id).filter(Boolean));
  const sheetDays = new Set(fromSheet.map((w) => dayOf(w.sortKey)));
  const orphans: (RotaWalk & { sortKey: string })[] = suWalks
    .filter((e: SUEvent) => !linked.has(e.suu_event_id!) && !sheetDays.has(dayOf(e.starts_at!)))
    .map((e) => ({
      sortKey: e.starts_at!,
      key: `su:${e.suu_event_id}`,
      walkId: null,
      eventId: e.id,
      name: eventDetails(e).name,
      when: `${longDate(e.starts_at!)} · ${eventWhen(e)}`,
      weekday: londonDate(e.starts_at!, { weekday: "short" }),
      day: londonDate(e.starts_at!, { day: "numeric" }),
      month: month(e.starts_at!),
      editable: false,
      values: Object.fromEntries(ROTA_FIELDS.map((k) => [k, ""])) as Record<RotaField, string>,
      conflicts: {},
      version: "",
      leaders: [],
      extra: 0,
      shadowing: 0,
    }));

  const walks: RotaWalk[] = [...fromSheet, ...orphans].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  return (
    <article className="events-page">
      <EventsSubnav active="rota" showRota showProgramme={canAssign} />
      <p className="day-note">Tap a walk to put names in its slots. It&apos;s the WL calendar: what you type here goes on the sheet, and what&apos;s typed there shows here.</p>
      <RotaBoard walks={walks} />
    </article>
  );
}
