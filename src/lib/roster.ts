import type { MembershipTier } from "@/lib/access";

/**
 * TEMPORARY name matching between the SU roster and UCL sign-in identities.
 * Retire with the `hiking-roster-sync` job (see supabase/migrations/20260914000000_su_roster.sql).
 *
 * The SU members page shows "First Last" with no email; UCL identities from the
 * Toolbox carry a name in the same order. A match must be unambiguous: exactly
 * one roster entry, or nobody gets in on a name alone.
 */

export const ROSTER_SYNC_SOURCE = "suu-roster";

export interface RosterEntry {
  full_name: string;
  membership_tier: MembershipTier;
  membership_expires_at: string | null;
}

const TIERS: Record<string, MembershipTier> = {
  taster: "taster",
  standard: "standard",
  explorer: "explorer",
};

/** "Taster" / "Standard Membership" / "Explorer" → tier, or null for anything unrecognised. */
export function tierFromMembershipType(value: string | null | undefined): MembershipTier | null {
  const words = (value ?? "").toLowerCase().split(/[^a-z]+/);
  const found = words.map((word) => TIERS[word]).filter(Boolean);
  return found.length === 1 ? found[0] : null;
}

/** Lower-cased, accent-free name words, in any order ("Cleary, Adam" = "Adam Cleary"). */
export function nameTokens(name: string | null | undefined): Set<string> {
  const plain = (name ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return new Set(plain ? plain.split(" ") : []);
}

function isSubset(small: Set<string>, large: Set<string>): boolean {
  for (const token of small) if (!large.has(token)) return false;
  return true;
}

/**
 * The one roster entry for this name, or null.
 *
 * Exact word-set matches win. Failing that, one name's words may be a subset of
 * the other's — a middle name on one side only — as long as both have at least
 * a first and last name and exactly one entry fits.
 */
export function matchRosterByName<T extends RosterEntry>(roster: T[], name: string | null | undefined): T | null {
  const wanted = nameTokens(name);
  if (wanted.size < 2) return null;

  const withTokens = roster.map((entry) => ({ entry, tokens: nameTokens(entry.full_name) }));
  const exact = withTokens.filter(({ tokens }) => tokens.size === wanted.size && isSubset(wanted, tokens));
  if (exact.length === 1) return exact[0].entry;
  if (exact.length > 1) return null;

  const partial = withTokens.filter(
    ({ tokens }) => tokens.size >= 2 && (isSubset(wanted, tokens) || isSubset(tokens, wanted)),
  );
  return partial.length === 1 ? partial[0].entry : null;
}
