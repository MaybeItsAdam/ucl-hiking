create table if not exists public.suu_session_settings (
  id text primary key default 'default',
  session_id text,
  auth_state text,
  status text not null default 'unconfigured' check (status in ('active', 'expired', 'error', 'unconfigured')),
  last_error text,
  last_checked_at timestamptz,
  updated_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  suu_event_id text unique,
  title text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  status text not null default 'upcoming' check (status in ('upcoming', 'sold_out', 'cancelled', 'completed', 'draft')),
  capacity integer not null default 0 check (capacity >= 0),
  tickets_sold integer not null default 0 check (tickets_sold >= 0),
  price_pence integer not null default 0 check (price_pence >= 0),
  source_reference text,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  received_count integer not null,
  upserted_count integer not null,
  status text not null default 'success',
  error_message text,
  started_at timestamptz not null,
  completed_at timestamptz not null default now()
);

create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  description text,
  total_quantity integer not null check (total_quantity >= 0),
  available_quantity integer not null check (available_quantity >= 0 and available_quantity <= total_quantity),
  condition text not null default 'good' check (condition in ('excellent', 'good', 'fair', 'needs_repair')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.equipment_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  purpose text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'returned', 'cancelled')),
  notes text,
  reviewed_by uuid references public.members(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.suu_session_settings enable row level security;
alter table public.events enable row level security;
alter table public.event_sync_runs enable row level security;
alter table public.equipment enable row level security;
alter table public.equipment_requests enable row level security;

revoke all on public.suu_session_settings from anon, authenticated;
revoke all on public.events from anon, authenticated;
revoke all on public.event_sync_runs from anon, authenticated;
revoke all on public.equipment from anon, authenticated;
revoke all on public.equipment_requests from anon, authenticated;

create index if not exists events_starts_at_idx on public.events (starts_at desc);
create index if not exists equipment_requests_member_idx on public.equipment_requests (member_id);
create index if not exists equipment_requests_status_idx on public.equipment_requests (status);

create trigger suu_session_settings_set_updated_at before update on public.suu_session_settings
for each row execute function public.set_updated_at();

create trigger events_set_updated_at before update on public.events
for each row execute function public.set_updated_at();

create trigger equipment_set_updated_at before update on public.equipment
for each row execute function public.set_updated_at();

create trigger equipment_requests_set_updated_at before update on public.equipment_requests
for each row execute function public.set_updated_at();
