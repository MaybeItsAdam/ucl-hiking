import type { Metadata } from "next";
import { ago } from "@/lib/ago";
import { redirect } from "next/navigation";
import { EventsSubnav } from "@/components/EventsSubnav";
import { ProgrammeBoard, type ProgrammeEvent, type ProgrammeWalk } from "@/components/ProgrammeBoard";
import { can, profileOf } from "@/lib/access";
import { getEventsInClubYear } from "@/lib/events";
import { clubYear, clubYearLabel } from "@/lib/hikeMap";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { FIELD_BY_KEY, isWalkKind, visibilityFromMembership } from "@/lib/walkSheet";
import { lastSync, pullIfStale, type StoredWalk } from "@/lib/walkSheetSync";
import type { EventKind } from "@/lib/eventDetails";

export const metadata: Metadata = { title: "Programme | UCL Hiking Club" };
export const maxDuration = 60;

const ZONE = "Europe/London";
const fmt = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, ...options }).format(new Date(`${iso}T12:00:00Z`));

/**
 * The committee calendar, synced: each row with its publish switch and who
 * can see it. Opening the page pulls the sheet if it's more than a few
 * minutes old; edits go straight back to the sheet.
 */
export default async function ProgrammePage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  if (!can(profileOf(member), "manage_walks")) redirect("/portal/events");

  const year = clubYear();
  let walks: StoredWalk[] = [];
  let names = new Map<string, string>();
  let eventIds = new Map<string, string>();
  let events: ProgrammeEvent[] = [];
  let sync: Awaited<ReturnType<typeof lastSync>> = null;
  let missing = false;

  if (isSupabaseConfigured()) {
    // The SU's events don't come from the sheet, so they load while it's pulled.
    const [, suEvents] = await Promise.all([pullIfStale(), getEventsInClubYear(year)]);
    const supabase = getSupabaseAdmin();
    const walksLoad = supabase
      .from("sheet_walks")
      .select("*")
      .eq("present", true)
      .gte("starts_on", `${year}-09-01`)
      .lte("starts_on", `${year + 1}-08-31`)
      .order("starts_on", { ascending: true })
      .order("sheet_row", { ascending: true });
    const [{ data, error }, lastSynced] = await Promise.all([walksLoad, lastSync().catch(() => null)]);
    missing = Boolean(error);
    walks = (data ?? []) as StoredWalk[];
    sync = lastSynced;

    const editors = [...new Set(walks.flatMap((w) => Object.values(w.conflicts ?? {}).map((c) => c.by)).filter((id): id is string => Boolean(id)))];
    if (editors.length) {
      const { data: people } = await supabase.from("members").select("id, full_name").in("id", editors);
      names = new Map((people ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? "Someone"]));
    }
    eventIds = new Map(suEvents.filter((e) => e.suu_event_id).map((e) => [e.suu_event_id!, e.id]));
    events = suEvents
      .filter((e) => e.suu_event_id && e.starts_at)
      .map((e) => ({ suuId: e.suu_event_id!, label: `${fmt(e.starts_at!.slice(0, 10), { day: "numeric", month: "short" })} · ${e.title}` }));
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date());
  const rows: ProgrammeWalk[] = walks
    .filter((w) => w.starts_on)
    .map((w) => ({
      id: w.id,
      title: w.title,
      kind: w.kind,
      date: w.starts_on,
      weekday: fmt(w.starts_on!, { weekday: "short" }),
      day: fmt(w.starts_on!, { day: "numeric" }),
      month: fmt(w.starts_on!, { month: "long", year: "numeric" }),
      hasPlanning: w.planning_row !== null,
      status: (w.shown?.status ?? "").trim(),
      published: w.published,
      publishedFromSheet: w.published_source === "sheet",
      visibility: w.visibility,
      visibilityFromSheet: w.visibility_source === "sheet",
      sheetVisibility: visibilityFromMembership(w.sheet_values?.membership ?? ""),
      eventSuuId: w.event_suu_id,
      eventId: w.event_suu_id ? eventIds.get(w.event_suu_id) ?? null : null,
      linkAuto: w.link_source !== "manual",
      values: w.sheet_values ?? {},
      conflicts: Object.entries(w.conflicts ?? {}).map(([field, c]) => ({
        field,
        label: FIELD_BY_KEY.get(field)?.label ?? field,
        sheet: c.sheet,
        app: c.app,
        by: c.by ? names.get(c.by) ?? null : null,
      })),
      past: w.starts_on! < today,
      isWalk: isWalkKind(w.kind as EventKind),
    }));

  return (
    <article className="events-page programme-page">
      <EventsSubnav active="programme" showRota showProgramme />
      <p className="event-eyebrow">{clubYearLabel(year)} programme</p>
      {missing ? (
        <p className="day-note">The programme tables aren&apos;t in the database yet. They arrive with the next deploy.</p>
      ) : (
        <ProgrammeBoard
          walks={rows}
          events={events}
          synced={sync?.finished_at ? ago(sync.finished_at) : null}
          syncError={sync && sync.ok === false ? sync.error : null}
        />
      )}
    </article>
  );
}
