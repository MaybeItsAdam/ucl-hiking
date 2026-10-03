import type { GovernanceRole, MembershipTier } from "@/lib/access";

/**
 * The committee membership list: Toolbox's SU roster, with each person's site
 * account attached by their linked UCL login. Linking is Toolbox's job (it
 * links unambiguous names itself; principals link the rest on /connector).
 */

export interface RosterEntry {
  full_name: string;
  membership_tier: MembershipTier;
  membership_expires_at: string | null;
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
 * The SU roster with each person's site account attached by linked login,
 * followed by accounts on nobody's row (committee added by hand, say).
 */
export function buildMembershipList<T extends RosterEntry & { id: string; member_type: string | null; toolbox_user_id?: string | null }>(
  roster: T[],
  accounts: RosterAccount[],
): MembershipListEntry[] {
  const accountByEntry = new Map<T, RosterAccount>();
  const unmatched: RosterAccount[] = [];
  const byToolboxId = new Map(roster.flatMap((entry) => (entry.toolbox_user_id ? [[entry.toolbox_user_id, entry] as const] : [])));
  for (const account of accounts) {
    const entry = account.toolbox_user_id ? byToolboxId.get(account.toolbox_user_id) : undefined;
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
