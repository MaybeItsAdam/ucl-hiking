-- When each walk's SU ticket list was last asked of Toolbox, and how old the
-- list it gave back was. Toolbox asks consumers to check a list at most every
-- 15 minutes and to show its age; this row is how both are kept.
create table if not exists public.ticket_list_checks (
  event_suu_id text primary key,
  checked_at timestamptz not null,
  -- Toolbox's syncedAt: when a principal's Connector last read the SU page.
  synced_at timestamptz,
  status text not null
);

alter table public.ticket_list_checks enable row level security;
