-- Toolbox membership sync has no shadow mode any more: every run applies the
-- roster. The mode column added earlier the same day only ever said 'shadow'.
alter table public.member_sync_runs drop column if exists mode;
