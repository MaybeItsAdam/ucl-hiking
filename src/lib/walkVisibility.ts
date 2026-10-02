import { can, profileOf } from "@/lib/access";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import type { Member, SUEvent } from "@/lib/types";
import { canSee, type Viewer, type Visibility } from "@/lib/walkSheet";

/**
 * Who sees which SU event. An event the committee calendar knows about is
 * shown once it's published there, to the rungs of the ladder its visibility
 * allows; one the calendar doesn't know about is shown as before.
 */

export interface WalkRule {
  published: boolean;
  visibility: Visibility;
}

export function viewerOf(member: Pick<Member, "membership_tier" | "governance_role" | "is_walk_leader"> | null): Viewer {
  if (!member) return { tier: null, isLeader: false, isCommittee: false };
  const profile = profileOf(member);
  return { tier: member.membership_tier, isLeader: can(profile, "lead_walks"), isCommittee: can(profile, "manage_walks") };
}

/** Rules for these SU events, keyed by SU id. A missing table (before the migration) reads as none. */
export async function walkRules(suuIds: (string | null | undefined)[]): Promise<Map<string, WalkRule>> {
  const ids = [...new Set(suuIds.filter((id): id is string => Boolean(id)))];
  const rules = new Map<string, WalkRule>();
  if (!ids.length || !isSupabaseConfigured()) return rules;
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await getSupabaseAdmin()
      .from("sheet_walks")
      .select("event_suu_id, published, visibility")
      .eq("present", true)
      .in("event_suu_id", ids.slice(i, i + 300));
    if (error) return rules;
    for (const r of data ?? []) rules.set(r.event_suu_id as string, { published: r.published as boolean, visibility: r.visibility as Visibility });
  }
  return rules;
}

export function visibleWith(event: Pick<SUEvent, "suu_event_id">, rules: Map<string, WalkRule>, viewer: Viewer): boolean {
  const rule = event.suu_event_id ? rules.get(event.suu_event_id) : undefined;
  return rule ? canSee(rule, viewer) : true;
}

/** The events this member may see, in the same order. */
export async function visibleEvents<T extends Pick<SUEvent, "suu_event_id">>(events: T[], viewer: Viewer): Promise<T[]> {
  if (viewer.isCommittee) return events;
  const rules = await walkRules(events.map((e) => e.suu_event_id));
  return events.filter((e) => visibleWith(e, rules, viewer));
}

export async function canSeeEvent(event: Pick<SUEvent, "suu_event_id">, viewer: Viewer): Promise<boolean> {
  if (viewer.isCommittee) return true;
  return visibleWith(event, await walkRules([event.suu_event_id]), viewer);
}
