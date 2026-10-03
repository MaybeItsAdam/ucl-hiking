-- Every Toolbox member sync leaves a row, including shadow runs and failures.
--
-- Before this, only an authoritative run wrote to member_sync_runs, so the
-- shadow comparison that has to stay clean before TOOLBOX_MEMBERS_AUTHORITATIVE
-- is switched on was returned to the cron caller and lost.

alter table public.member_sync_runs
  add column if not exists mode text check (mode in ('shadow', 'authoritative')),
  -- compareToolboxMembers(): toolboxEligible, hikingActive, onlyToolbox, onlyHiking, tierMismatches.
  add column if not exists comparison jsonb,
  -- Why nothing was changed, when the run stopped early.
  add column if not exists error text;
