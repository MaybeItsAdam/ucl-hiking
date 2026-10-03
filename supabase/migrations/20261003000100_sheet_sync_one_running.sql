-- One walk-sheet sync at a time, enforced by the database.
--
-- pullWalkSheet() used to check for a running sync and then insert its own run,
-- so two syncs started a fraction of a second apart (a page view and the Sync
-- button, on 2 Oct) both got through and tripped sheet_walks_event_idx linking
-- the same event. With this index the second insert fails and that sync stops.
-- A run that died without finishing is closed by the next sync after 2 minutes.

update public.sheet_sync_runs
set finished_at = now(), ok = false, error = coalesce(error, 'abandoned')
where finished_at is null;

create unique index if not exists sheet_sync_runs_one_running
  on public.sheet_sync_runs ((true)) where finished_at is null;
