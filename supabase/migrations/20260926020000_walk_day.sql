-- The walk itself: who is coming, the register on the day, safety details a
-- leader may need, incidents, who can lead, and kit booked for a walk.
-- Everything hangs off events.suu_event_id (see 20260926010000_event_plans.sql).

-- Who is on a walk. Toolbox supplies SU ticket holders; leaders add walk-ups.
create table if not exists public.event_attendees (
  id uuid primary key default gen_random_uuid(),
  event_suu_id text not null,
  member_id uuid references public.members(id) on delete cascade,
  name text not null,
  email citext,
  source text not null check (source in ('toolbox', 'leader')),
  removed boolean not null default false,
  checked_in_at timestamptz,
  checked_in_by uuid references public.members(id) on delete set null,
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists event_attendees_email_key
  on public.event_attendees (event_suu_id, email) where email is not null;
create unique index if not exists event_attendees_member_key
  on public.event_attendees (event_suu_id, member_id) where member_id is not null;
create index if not exists event_attendees_member_idx on public.event_attendees (member_id);

-- Emergency contact and medical notes: special-category data, opt-in, and
-- encrypted by the app (AES-256-GCM, SAFETY_DATA_KEY) before it gets here.
create table if not exists public.member_safety (
  member_id uuid primary key references public.members(id) on delete cascade,
  payload_enc text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.incident_reports (
  id uuid primary key default gen_random_uuid(),
  event_suu_id text,
  reporter_member_id uuid references public.members(id) on delete set null,
  occurred_at timestamptz not null,
  kind text not null check (kind in ('injury', 'illness', 'near_miss', 'lost_person', 'equipment', 'other')),
  description text not null,
  actions_taken text,
  follow_up text,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists incident_reports_created_idx on public.incident_reports (created_at desc);

create table if not exists public.leader_availability (
  event_suu_id text not null,
  member_id uuid not null references public.members(id) on delete cascade,
  status text not null check (status in ('available', 'maybe', 'unavailable')),
  updated_at timestamptz not null default now(),
  primary key (event_suu_id, member_id)
);

alter table public.equipment_requests add column if not exists event_suu_id text;

alter table public.event_attendees enable row level security;
alter table public.member_safety enable row level security;
alter table public.incident_reports enable row level security;
alter table public.leader_availability enable row level security;
revoke all on public.event_attendees from anon, authenticated;
revoke all on public.member_safety from anon, authenticated;
revoke all on public.incident_reports from anon, authenticated;
revoke all on public.leader_availability from anon, authenticated;

create trigger event_attendees_set_updated_at before update on public.event_attendees
  for each row execute function public.set_updated_at();
create trigger member_safety_set_updated_at before update on public.member_safety
  for each row execute function public.set_updated_at();
create trigger incident_reports_set_updated_at before update on public.incident_reports
  for each row execute function public.set_updated_at();
create trigger leader_availability_set_updated_at before update on public.leader_availability
  for each row execute function public.set_updated_at();
