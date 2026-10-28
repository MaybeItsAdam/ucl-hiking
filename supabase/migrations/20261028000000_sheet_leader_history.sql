-- A history of who is down for each walk on the WL calendar.
--
-- Google's version history is the only other record of the sign-up columns,
-- and restoring a whole old version throws away every later edit (26 Oct: a
-- restore to 13 Oct dropped two weeks of sign-ups). Each sync now writes a row
-- here for any walk whose six leader slots, additional leaders or shadowing
-- cells changed, so the sheet's sign-ups can be put back from our own copy.

create table if not exists public.sheet_leader_history (
  id bigint generated always as identity primary key,
  row_key text not null,
  starts_on date,
  title text not null,
  -- leader1…leader6, extraLeaders, shadowing: the cell text as read.
  cells jsonb not null,
  seen_at timestamptz not null default now()
);

create index if not exists sheet_leader_history_row_idx on public.sheet_leader_history (row_key, seen_at desc);

alter table public.sheet_leader_history enable row level security;
revoke all on public.sheet_leader_history from anon, authenticated;
