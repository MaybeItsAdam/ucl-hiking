-- The trip brief a leader writes for an event: who leads, where and when to
-- meet, how people get there, what to carry and where to book.
--
-- Keyed by events.suu_event_id, never events.id: Toolbox's reconcile deletes
-- and recreates event rows, which changes the uuid but keeps the SU id.

create table if not exists public.event_plans (
  event_suu_id text primary key,
  leader_member_id uuid references public.members(id) on delete set null,
  backmarker_member_id uuid references public.members(id) on delete set null,
  meet_at timestamptz,
  meet_point text,
  transport text,
  kit_list text[] not null default '{}',
  route_url text,
  booking_url text,
  notes text,
  updated_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_plans_leader_idx on public.event_plans (leader_member_id);
create index if not exists event_plans_backmarker_idx on public.event_plans (backmarker_member_id);

alter table public.event_plans enable row level security;
revoke all on public.event_plans from anon, authenticated;

create trigger event_plans_set_updated_at before update on public.event_plans
  for each row execute function public.set_updated_at();

-- Bumping this invalidates a member's calendar feed URL.
alter table public.members add column if not exists calendar_key_version integer not null default 0;
