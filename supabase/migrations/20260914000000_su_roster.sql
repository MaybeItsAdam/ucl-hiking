-- TEMPORARY. The SU members roster, by name, until the Toolbox Connector and its
-- members API replace it (plan: adams-campus-toolbox docs/plans/connector-rollout-plan.md).
--
-- The SU members page has no email column, but `members` is keyed on email, so the
-- daily `hiking-roster-sync` job stores the roster here and sign-in matches a UCL
-- account's name against it (src/lib/roster.ts). Drop this table when the job is retired.
create table public.su_roster (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  member_type text,
  membership_tier public.membership_tier not null,
  membership_expires_at timestamptz,
  synced_at timestamptz not null default now()
);

alter table public.su_roster enable row level security;
