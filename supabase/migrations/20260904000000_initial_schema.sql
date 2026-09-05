create extension if not exists citext;
create extension if not exists pgcrypto;

create type public.membership_tier as enum ('taster', 'standard', 'explorer');
create type public.governance_role as enum ('committee', 'principal', 'admin');

create type public.walk_difficulty as enum ('easy', 'moderate', 'challenging');
create type public.walk_visibility as enum ('public', 'members', 'explorers');

create table public.members (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  full_name text,
  toolbox_user_id text unique,
  membership_tier public.membership_tier not null,
  governance_role public.governance_role,
  is_walk_leader boolean not null default false,
  membership_expires_at timestamptz,
  source_reference text,
  sync_source text not null default 'ucl-suu-membership-job',
  synced_at timestamptz not null default now(),
  last_signed_in_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.walks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  location text not null,
  starts_at timestamptz not null,
  distance_km numeric(5, 1) not null check (distance_km > 0),
  ascent_m integer not null check (ascent_m >= 0),
  difficulty public.walk_difficulty not null,
  capacity integer not null check (capacity > 0),
  spaces_remaining integer not null check (
    spaces_remaining >= 0 and spaces_remaining <= capacity
  ),
  visibility public.walk_visibility not null default 'members',
  summary text,
  leader_member_id uuid references public.members(id) on delete set null,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.walk_registrations (
  walk_id uuid not null references public.walks(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  status text not null default 'confirmed' check (status in ('confirmed', 'waitlist', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (walk_id, member_id)
);

create table public.member_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  received_count integer not null,
  upserted_count integer not null,
  revoked_count integer not null default 0,
  started_at timestamptz not null,
  completed_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_member_id uuid references public.members(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index members_active_email_idx on public.members (email) where revoked_at is null;
create index walks_upcoming_idx on public.walks (starts_at) where published = true;
create index audit_log_created_idx on public.audit_log (created_at desc);

alter table public.members enable row level security;
alter table public.walks enable row level security;
alter table public.walk_registrations enable row level security;
alter table public.member_sync_runs enable row level security;
alter table public.audit_log enable row level security;

-- External UCL identity does not mint Supabase Auth JWTs. Consequently the
-- browser gets no direct table grants: all reads/writes go through server
-- routes which validate the Hiking HttpOnly session and then use service_role.
revoke all on public.members from anon, authenticated;
revoke all on public.walks from anon, authenticated;
revoke all on public.walk_registrations from anon, authenticated;
revoke all on public.member_sync_runs from anon, authenticated;
revoke all on public.audit_log from anon, authenticated;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger members_set_updated_at before update on public.members
for each row execute function public.set_updated_at();
create trigger walks_set_updated_at before update on public.walks
for each row execute function public.set_updated_at();
create trigger registrations_set_updated_at before update on public.walk_registrations
for each row execute function public.set_updated_at();
