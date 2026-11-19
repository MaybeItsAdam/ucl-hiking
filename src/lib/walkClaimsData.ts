import { getEventsBySuuIds } from "@/lib/events";
import { a1, readValues } from "@/lib/googleSheets";
import type { BoardWalk } from "@/lib/leaderboard";
import { signReadToken } from "@/lib/reimbursementToken";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import type { Member } from "@/lib/types";
import { readRoster, TABS, WALK_SHEETS } from "@/lib/walkSheet";
import {
  calendarWalksLed,
  claimStatuses,
  identityOf,
  isClaimRow,
  plannedWalksLed,
  type ClaimRow,
  type LedWalk,
  type WalkClaimStatus,
} from "@/lib/walkClaims";

export type { WalkClaimStatus } from "@/lib/walkClaims";

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
      // Apps Script can take several seconds from cold; the page streams this section, so it can wait.
      signal: AbortSignal.timeout(15_000),
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

export interface WalkClaimsView {
  /** Walks they led or backmarked in the window, newest first. */
  walks: WalkClaimStatus[];
  /** False when the reimbursement spreadsheet couldn't be read: every walk's `claimed` is null. */
  claimsKnown: boolean;
  /** Whether their account is tied to a roster row (see Identity.linked). */
  linked: boolean;
  /** The roster's name for them, when there's a row that's theirs or looks it. */
  calendarName: string | null;
  /** Roster names nobody has linked, for "which one is you?". Null when the roster couldn't be read. */
  unlinkedNames: string[] | null;
}

const londonDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);

/**
 * The walks this leader led or backmarked in the last CLAIM_LOOKBACK_DAYS,
 * each marked claimed or not. Walks come from the committee calendar (by the
 * names the roster gives them) and from the app's own plans (by member id).
 * Null only without a database; a spreadsheet that doesn't answer leaves the
 * walks listed with their claim status unknown.
 */
export async function walkClaimsFor(member: Member, now = new Date()): Promise<WalkClaimsView | null> {
  if (!isSupabaseConfigured()) return null;
  const today = londonDay(now);
  const since = londonDay(new Date(now.getTime() - CLAIM_LOOKBACK_DAYS * 24 * 60 * 60 * 1000));
  const supabase = getSupabaseAdmin();

  // Two days' more claims than walks, for a claim dated the day before a walk at the window's edge.
  const claimsSince = londonDay(new Date(now.getTime() - (CLAIM_LOOKBACK_DAYS + 2) * 24 * 60 * 60 * 1000));
  const [claims, rosterRows, me, sheetWalks, plans] = await Promise.all([
    fetchWlClaims(claimsSince),
    readValues(WALK_SHEETS.leaders, a1(TABS.roster, "A1:G")).catch(() => null),
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

  const roster = rosterRows ? readRoster(rosterRows) : [];
  const who = identityOf(
    { email: member.email, full_name: member.full_name, wl_name: (me.data?.wl_name as string | null | undefined) ?? null },
    roster,
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
  const plannedEvents = planned.flatMap((id) => {
    const e = bySuuId.get(id);
    return e ? [e] : [];
  });
  walks.push(...plannedWalksLed(plannedEvents, fromCalendar, since, today, londonDay));

  return {
    walks: claimStatuses(walks, claims, who),
    claimsKnown: claims !== null,
    linked: who.linked,
    calendarName: who.calendarName,
    unlinkedNames: rosterRows
      ? roster
          .filter((r) => r.active && !r.email)
          .map((r) => r.name)
          .sort((a, b) => a.localeCompare(b))
      : null,
  };
}
