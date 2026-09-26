import { eventDetails } from "@/lib/eventDetails";
import type { SUEvent } from "@/lib/types";

const ZONE = "Europe/London";
const MONTHS = ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"];

export interface StatsAttendee {
  event_suu_id: string;
  member_id: string | null;
  name: string;
  removed: boolean;
  checked_in_at: string | null;
}

export interface TierChange {
  member_id: string;
  from_tier: string | null;
  to_tier: string;
  changed_at: string;
}

export interface ClubStats {
  walksRun: number;
  walksUpcoming: number;
  uniqueWalkers: number;
  repeatRate: number | null;
  averageFill: number | null;
  noShowRate: number | null;
  byMonth: { label: string; walks: number; walkers: number }[];
  topLeaders: { memberId: string; name: string; walks: number }[];
  tasters: number;
  tastersConverted: number;
}

const walking = (e: SUEvent) => ["hike", "walk", "trip"].includes(eventDetails(e).kind);

function monthIndex(iso: string): number {
  const month = Number(new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, month: "numeric" }).format(new Date(iso)));
  return (month + 3) % 12; // September is 0
}

/** Someone on a register: the member if known, else the name a leader typed. */
const personKey = (a: StatsAttendee) => a.member_id ?? `name:${a.name.trim().toLowerCase()}`;

export function clubStats(
  events: SUEvent[],
  attendees: StatsAttendee[],
  leaders: { event_suu_id: string; leader_member_id: string | null; leader_name: string | null }[],
  tierChanges: TierChange[],
  now = new Date(),
): ClubStats {
  const walks = events.filter((e) => walking(e) && e.status !== "cancelled" && e.starts_at);
  const past = walks.filter((e) => new Date(e.starts_at!).getTime() < now.getTime());
  const pastIds = new Set(past.map((e) => e.suu_event_id).filter(Boolean) as string[]);
  const onPast = attendees.filter((a) => !a.removed && pastIds.has(a.event_suu_id));

  const walksPerPerson = new Map<string, number>();
  for (const a of onPast) walksPerPerson.set(personKey(a), (walksPerPerson.get(personKey(a)) ?? 0) + 1);
  const unique = walksPerPerson.size;
  const repeaters = [...walksPerPerson.values()].filter((n) => n >= 2).length;

  const filled = past.filter((e) => e.capacity > 0);
  const averageFill = filled.length ? filled.reduce((sum, e) => sum + Math.min(1, e.tickets_sold / e.capacity), 0) / filled.length : null;

  // Only walks where the leader used the register say anything about no-shows.
  const registered = new Set(onPast.filter((a) => a.checked_in_at).map((a) => a.event_suu_id));
  const expected = onPast.filter((a) => registered.has(a.event_suu_id));
  const noShowRate = expected.length ? expected.filter((a) => !a.checked_in_at).length / expected.length : null;

  const byMonth = MONTHS.map((label) => ({ label, walks: 0, walkers: 0 }));
  const walkMonth = new Map<string, number>();
  for (const e of past) {
    const i = monthIndex(e.starts_at!);
    byMonth[i].walks += 1;
    if (e.suu_event_id) walkMonth.set(e.suu_event_id, i);
  }
  for (const a of onPast) {
    const i = walkMonth.get(a.event_suu_id);
    if (i !== undefined) byMonth[i].walkers += 1;
  }

  const led = new Map<string, { name: string; walks: number }>();
  for (const l of leaders) {
    if (!l.leader_member_id || !pastIds.has(l.event_suu_id)) continue;
    const entry = led.get(l.leader_member_id) ?? { name: l.leader_name ?? "Unnamed", walks: 0 };
    entry.walks += 1;
    led.set(l.leader_member_id, entry);
  }
  const topLeaders = [...led.entries()]
    .map(([memberId, v]) => ({ memberId, ...v }))
    .sort((a, b) => b.walks - a.walks || a.name.localeCompare(b.name))
    .slice(0, 5);

  const tasterIds = new Set(tierChanges.filter((c) => c.to_tier === "taster").map((c) => c.member_id));
  const converted = new Set(
    tierChanges.filter((c) => c.from_tier === "taster" && (c.to_tier === "standard" || c.to_tier === "explorer")).map((c) => c.member_id),
  );
  for (const id of converted) tasterIds.add(id);

  return {
    walksRun: past.length,
    walksUpcoming: walks.length - past.length,
    uniqueWalkers: unique,
    repeatRate: unique ? repeaters / unique : null,
    averageFill,
    noShowRate,
    byMonth,
    topLeaders,
    tasters: tasterIds.size,
    tastersConverted: converted.size,
  };
}

/** Who a broadcast goes to. */
export type Audience =
  | { type: "all" }
  | { type: "tier"; tier: "taster" | "standard" | "explorer" }
  | { type: "leaders" }
  | { type: "event"; eventSuuId: string };

export function parseAudience(value: unknown): Audience | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.type === "all" || v.type === "leaders") return { type: v.type };
  if (v.type === "tier" && (v.tier === "taster" || v.tier === "standard" || v.tier === "explorer")) return { type: "tier", tier: v.tier };
  if (v.type === "event" && typeof v.eventSuuId === "string" && v.eventSuuId) return { type: "event", eventSuuId: v.eventSuuId };
  return null;
}
