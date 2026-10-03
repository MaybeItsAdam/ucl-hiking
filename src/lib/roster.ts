import type { GovernanceRole, MembershipTier } from "@/lib/access";

/**
 * Name matching between Toolbox's SU roster and UCL sign-in identities, for
 * members whose login isn't confirmed in the Toolbox connector yet. It stops
 * letting anyone in once Toolbox membership sync is authoritative
 * (TOOLBOX_MEMBERS_AUTHORITATIVE=true).
 *
 * The SU roster gives "First Last" with no email; UCL identities from the
 * Toolbox carry a name in the same order. A match must be unambiguous: exactly
 * one roster entry, or nobody gets in on a name alone.
 */

export interface RosterEntry {
  full_name: string;
  membership_tier: MembershipTier;
  membership_expires_at: string | null;
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
  return rosterNameMatcher(roster)(name);
}

/** matchRosterByName with the roster's names tokenised once, for matching many names. */
export function rosterNameMatcher<T extends RosterEntry>(roster: T[]): (name: string | null | undefined) => T | null {
  const withTokens = roster.map((entry) => ({ entry, tokens: nameTokens(entry.full_name) }));
  return (name) => {
    const wanted = nameTokens(name);
    if (wanted.size < 2) return null;

    const exact = withTokens.filter(({ tokens }) => tokens.size === wanted.size && isSubset(wanted, tokens));
    if (exact.length === 1) return exact[0].entry;
    if (exact.length > 1) return null;

    const partial = withTokens.filter(
      ({ tokens }) => tokens.size >= 2 && (isSubset(wanted, tokens) || isSubset(tokens, wanted)),
    );
    return partial.length === 1 ? partial[0].entry : null;
  };
}

/** An account on the site, as far as the membership list needs it. */
export interface RosterAccount {
  id: string;
  toolbox_user_id?: string | null;
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
 * The SU roster with each person's site account attached (by confirmed Toolbox
 * login, else by name), followed by
 * accounts matching nobody on the roster (committee added by hand, say).
 */
export function buildMembershipList<T extends RosterEntry & { id: string; member_type: string | null; toolbox_user_id?: string | null }>(
  roster: T[],
  accounts: RosterAccount[],
): MembershipListEntry[] {
  const accountByEntry = new Map<T, RosterAccount>();
  const unmatched: RosterAccount[] = [];
  const matchName = rosterNameMatcher(roster);
  const byToolboxId = new Map(roster.flatMap((entry) => (entry.toolbox_user_id ? [[entry.toolbox_user_id, entry] as const] : [])));
  for (const account of accounts) {
    // A login confirmed in the Toolbox connector, then a name match.
    const entry = (account.toolbox_user_id && byToolboxId.get(account.toolbox_user_id)) || matchName(account.full_name);
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
