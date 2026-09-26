import type { GovernanceRole, MembershipTier } from "@/lib/access";

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

/** An account on the site, as far as the membership list needs it. */
export interface RosterAccount {
  id: string;
  email: string;
  full_name: string | null;
  membership_tier: MembershipTier;
  governance_role: GovernanceRole | null;
  is_walk_leader: boolean;
  membership_expires_at: string | null;
  last_signed_in_at?: string | null;
  governance_role_locked?: boolean;
  walk_leader_locked?: boolean;
}

/** One row of the committee membership list. */
export interface MembershipListEntry {
  id: string;
  full_name: string;
  member_type: string | null;
  membership_tier: MembershipTier;
  membership_expires_at: string | null;
  /** The site account matched to this person, if they have signed in. */
  member_id: string | null;
  email: string | null;
  last_signed_in_at: string | null;
  governance_role: GovernanceRole | null;
  is_walk_leader: boolean;
  /** Set by hand on the Members page; the sync leaves it alone. */
  governance_role_locked: boolean;
  walk_leader_locked: boolean;
  on_roster: boolean;
}

function accountFields(account: RosterAccount | undefined) {
  return {
    member_id: account?.id ?? null,
    email: account?.email ?? null,
    last_signed_in_at: account?.last_signed_in_at ?? null,
    governance_role: account?.governance_role ?? null,
    is_walk_leader: account?.is_walk_leader ?? false,
    governance_role_locked: account?.governance_role_locked ?? false,
    walk_leader_locked: account?.walk_leader_locked ?? false,
  };
}

/**
 * The SU roster with each person's site account attached by name, followed by
 * accounts matching nobody on the roster (committee added by hand, say).
 */
export function buildMembershipList<T extends RosterEntry & { id: string; member_type: string | null }>(
  roster: T[],
  accounts: RosterAccount[],
): MembershipListEntry[] {
  const accountByEntry = new Map<T, RosterAccount>();
  const unmatched: RosterAccount[] = [];
  for (const account of accounts) {
    const entry = matchRosterByName(roster, account.full_name);
    if (entry && !accountByEntry.has(entry)) accountByEntry.set(entry, account);
    else unmatched.push(account);
  }

  const onRoster = roster.map((entry): MembershipListEntry => {
    const account = accountByEntry.get(entry);
    return {
      id: entry.id,
      full_name: entry.full_name,
      member_type: entry.member_type,
      membership_tier: entry.membership_tier,
      membership_expires_at: entry.membership_expires_at,
      ...accountFields(account),
      on_roster: true,
    };
  });

  const offRoster = unmatched.map(
    (account): MembershipListEntry => ({
      id: account.id,
      full_name: account.full_name || account.email.split("@")[0],
      member_type: null,
      membership_tier: account.membership_tier,
      membership_expires_at: account.membership_expires_at,
      ...accountFields(account),
      on_roster: false,
    }),
  );

  const byName = (a: MembershipListEntry, b: MembershipListEntry) => a.full_name.localeCompare(b.full_name, "en-GB");
  return [...onRoster.sort(byName), ...offRoster.sort(byName)];
}
