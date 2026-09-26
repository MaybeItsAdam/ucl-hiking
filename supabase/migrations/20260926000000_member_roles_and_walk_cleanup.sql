-- Committee seats and walk leadership are now set on the Members page.
--
-- The member sync job and Toolbox sign-in both write these two columns from
-- their own policy, which used to undo a hand-set role within a day. A lock
-- says "a person set this; leave it alone". Clearing it hands the column back
-- to the sync. Principal and admin still come from Toolbox and override a
-- lock: the app never grants those.
alter table public.members
  add column if not exists governance_role_locked boolean not null default false,
  add column if not exists walk_leader_locked boolean not null default false;

-- Sign-ups happen on the SU. The in-app walk booking tables were never written
-- by any screen; walk plans, attendees and leaders hang off events from here on.
drop table if exists public.walk_registrations;
drop table if exists public.walks;
drop type if exists public.walk_difficulty;
drop type if exists public.walk_visibility;
