import { NextResponse } from "next/server";
import { getEventPlans } from "@/lib/eventPlans";
import { buildCalendar, calendarSignatureMatches, readCalendarToken, toIcsEvent } from "@/lib/ics";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import type { SUEvent } from "@/lib/types";

type Params = { params: Promise<{ token: string }> };

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A member's subscribable feed of club events. Calendar apps fetch it without
 * cookies, so the URL itself is the credential: it names the member and is
 * signed with their current calendar key, which they can reset.
 */
export async function GET(_request: Request, { params }: Params) {
  const token = readCalendarToken((await params).token.replace(/\.ics$/i, ""));
  if (!token || !isSupabaseConfigured()) return new NextResponse("Not found", { status: 404 });

  const supabase = getSupabaseAdmin();
  const { data: member } = await supabase
    .from("members")
    .select("id, calendar_key_version, revoked_at, membership_expires_at")
    .eq("id", token.memberId)
    .maybeSingle();
  if (
    !member ||
    member.revoked_at ||
    (member.membership_expires_at && new Date(member.membership_expires_at) < new Date()) ||
    !calendarSignatureMatches(member.id, member.calendar_key_version ?? 0, token.signature)
  ) {
    return new NextResponse("Not found", { status: 404 });
  }

  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const { data } = await supabase
    .from("events")
    .select("*")
    .gte("starts_at", since)
    .neq("status", "draft")
    .order("starts_at", { ascending: true })
    .limit(300);
  const events = (data ?? []) as SUEvent[];
  const plans = await getEventPlans(events.map((e) => e.suu_event_id ?? ""));
  const entries = events
    .map((event) => {
      const plan = event.suu_event_id ? plans.get(event.suu_event_id) : undefined;
      return toIcsEvent(event, { meetPoint: plan?.meet_point, meetAt: plan?.meet_at });
    })
    .filter((entry) => entry !== null);

  return new NextResponse(buildCalendar(entries), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=900" },
  });
}
