import { can, type AccessProfile } from "@/lib/access";

/** Who can read a handbook page. The committee reads and edits them all. */
export const HANDBOOK_VISIBILITIES = ["committee", "walk_leaders", "members"] as const;
export type HandbookVisibility = (typeof HANDBOOK_VISIBILITIES)[number];

export const HANDBOOK_VISIBILITY_LABELS: Record<HandbookVisibility, string> = {
  committee: "Committee only",
  walk_leaders: "Walk leaders",
  members: "All members",
};

export function isHandbookVisibility(value: unknown): value is HandbookVisibility {
  return typeof value === "string" && HANDBOOK_VISIBILITIES.includes(value as HandbookVisibility);
}

/** The visibilities this person can read, or null for all of them (the committee). */
export function readableVisibilities(profile: AccessProfile): HandbookVisibility[] | null {
  return can(profile, "manage_club") ? null : sharedWith(profile.isWalkLeader);
}

/** What a non-committee member can read: everything for members, plus walk leaders' pages if they lead. */
export function sharedWith(isWalkLeader: boolean): HandbookVisibility[] {
  return isWalkLeader ? ["walk_leaders", "members"] : ["members"];
}
