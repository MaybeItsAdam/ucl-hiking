-- Members ask for walk leader access in the app instead of someone typing
-- their email into the WL roster sheet.
--
-- A request may name the roster row it belongs to (a leader the sync added
-- from the calendar, with no email yet). Approving it writes the member's
-- email into that row, so the daily sync keeps them a leader from then on.

create table if not exists public.walk_leader_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  -- The roster name they say is them, as written on the calendar; null for
  -- someone not on the calendar yet.
  wl_name text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  decided_by uuid references public.members(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- One open request per member.
create unique index if not exists walk_leader_requests_one_pending
  on public.walk_leader_requests (member_id) where status = 'pending';
create index if not exists walk_leader_requests_member_idx on public.walk_leader_requests (member_id, created_at desc);

alter table public.walk_leader_requests enable row level security;
revoke all on public.walk_leader_requests from anon, authenticated;
