import { getEventsBySuuIds } from "@/lib/events";
import { a1, readValues } from "@/lib/googleSheets";
import type { BoardWalk } from "@/lib/leaderboard";
import { signReadToken } from "@/lib/reimbursementToken";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import type { Member } from "@/lib/types";
import { readRoster, TABS, WALK_SHEETS } from "@/lib/walkSheet";
import { calendarWalksLed, claimedWalks, identityOf, isClaimRow, type ClaimRow, type LedWalk } from "@/lib/walkClaims";

/** How far back My walks looks for walks to claim. */
export const CLAIM_LOOKBACK_DAYS = 90;

const CACHE_MS = 2 * 60 * 1000;
let cached: { since: string; at: number; rows: ClaimRow[] } | null = null;

/**
 * Every walk-leader claim on the reimbursement spreadsheet for walks on or
 * after `since`, from the Apps Script. Null when the script isn't set up or
 * doesn't answer, so the page can leave claim status out rather than guess.
 * Kept for two minutes per server instance: the sheet changes slowly.
 */
export async function fetchWlClaims(since: string): Promise<ClaimRow[] | null> {
  const secret = process.env.REIMBURSE_SIGNING_SECRET;
  const endpoint = process.env.REIMBURSE_SCRIPT_URL;
  if (!secret || !endpoint) return null;
  if (cached && cached.since === since && Date.now() - cached.at < CACHE_MS) return cached.rows;
  try {
    // text/plain, as the browser sends claims: Apps Script reads either from postData.
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "wlClaims", token: signReadToken(secret), since }),
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; claims?: unknown } | null;
    if (!body?.ok || !Array.isArray(body.claims)) return null;
    const rows = body.claims.filter(isClaimRow);
    cached = { since, at: Date.now(), rows };
    return rows;
  } catch {
    return null;
  }
}

export interface WalkClaimStatus extends LedWalk {
  claimed: boolean;
}

const londonDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);

/**
 * The walks this leader led in the last CLAIM_LOOKBACK_DAYS, each marked
 * claimed or not, newest first. Null when claims can't be read: the caller
 * shows nothing rather than a list of false "Not claimed".
 */
export async function walkClaimStatuses(member: Member, now = new Date()): Promise<WalkClaimStatus[] | null> {
  if (!isSupabaseConfigured()) return null;
  const today = londonDay(now);
  const since = londonDay(new Date(now.getTime() - CLAIM_LOOKBACK_DAYS * 24 * 60 * 60 * 1000));
  const supabase = getSupabaseAdmin();

  // Two days' more claims than walks, for a claim dated the day before a walk at the window's edge.
  const claimsSince = londonDay(new Date(now.getTime() - (CLAIM_LOOKBACK_DAYS + 2) * 24 * 60 * 60 * 1000));
  const [claims, rosterRows, me, sheetWalks, plans] = await Promise.all([
    fetchWlClaims(claimsSince),
    readValues(WALK_SHEETS.leaders, a1(TABS.roster, "A1:G")).catch(() => [] as string[][]),
    supabase.from("members").select("wl_name").eq("id", member.id).maybeSingle(),
    supabase
      .from("sheet_walks")
      .select("row_key, starts_on, title, sheet_values, shown, event_suu_id")
      .eq("present", true)
      .gte("starts_on", since)
      .lt("starts_on", today)
      .limit(1000),
    supabase
      .from("event_plans")
      .select("event_suu_id")
      .or(`leader_member_id.eq.${member.id},backmarker_member_id.eq.${member.id}`),
  ]);
  if (!claims) return null;

  const who = identityOf(
    { email: member.email, full_name: member.full_name, wl_name: (me.data?.wl_name as string | null | undefined) ?? null },
    readRoster(rosterRows),
  );
  const fromCalendar = calendarWalksLed(
    (sheetWalks.data ?? []) as (BoardWalk & { row_key: string; event_suu_id: string | null })[],
    who,
    today,
    since,
  );

  // Link calendar walks to their event pages, and add walks the app's plans
  // name them on that the calendar doesn't credit them with.
  const planned = (plans.data ?? []).map((p) => String(p.event_suu_id));
  const events = await getEventsBySuuIds([...fromCalendar.flatMap((w) => (w.eventSuuId ? [w.eventSuuId] : [])), ...planned]);
  const bySuuId = new Map(events.map((e) => [e.suu_event_id, e]));
  const walks: LedWalk[] = fromCalendar.map(({ eventSuuId, ...w }) => ({
    ...w,
    eventId: (eventSuuId && bySuuId.get(eventSuuId)?.id) || null,
  }));
  const linked = new Set(fromCalendar.map((w) => w.eventSuuId).filter(Boolean));
  const dates = new Set(fromCalendar.map((w) => w.date));
  for (const suuId of planned) {
    const event = bySuuId.get(suuId);
    if (!event?.starts_at || linked.has(suuId) || event.status === "cancelled") continue;
    const date = londonDay(new Date(event.starts_at));
    if (date < since || date >= today || dates.has(date)) continue;
    const end = event.ends_at ? londonDay(new Date(event.ends_at)) : null;
    walks.push({ key: `event:${event.id}`, date, endDate: end, title: event.title, eventId: event.id });
    dates.add(date);
  }

  const claimed = claimedWalks(walks, claims, who);
  return walks
    .map((w) => ({ ...w, claimed: claimed.has(w.key) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
