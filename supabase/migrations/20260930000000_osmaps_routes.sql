-- Walk routes come from the club's OS Maps account.
--
-- The committee plans every walk in one OS Maps account. A daily job lists the
-- routes there, downloads each one's GPX (only when it changed), keeps the
-- parsed track here, and attaches the clear match to each walk in
-- event_routes. A leader can also pick one of these by hand.

create table if not exists public.osmaps_routes (
  id text primary key,
  name text not null,
  -- OS Maps' own "last changed" stamp, to skip re-downloading unchanged routes.
  remote_updated_at text,
  planned_for date,
  distance_m integer not null default 0 check (distance_m >= 0),
  ascent_m integer check (ascent_m >= 0),
  descent_m integer check (descent_m >= 0),
  start_lat double precision,
  start_lng double precision,
  finish_lat double precision,
  finish_lng double precision,
  -- Same shapes as event_routes.
  segments jsonb not null default '[]'::jsonb,
  waypoints jsonb not null default '[]'::jsonb,
  -- Still in the account at the last sync; false once deleted there.
  present boolean not null default true,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.osmaps_routes enable row level security;
revoke all on public.osmaps_routes from anon, authenticated;

drop trigger if exists osmaps_routes_set_updated_at on public.osmaps_routes;
create trigger osmaps_routes_set_updated_at before update on public.osmaps_routes
  for each row execute function public.set_updated_at();

-- Where a walk's route came from. 'osmaps_auto' rows are the sync's to replace;
-- 'osmaps_pick', 'upload' and 'url' were chosen by a person and it leaves them be.
alter table public.event_routes
  add column if not exists source text not null default 'upload'
    check (source in ('upload', 'url', 'osmaps_auto', 'osmaps_pick')),
  add column if not exists osmaps_route_id text references public.osmaps_routes(id) on delete set null,
  add column if not exists match_reasons text[];

update public.event_routes set source = 'url' where source_url is not null and source = 'upload';

create table if not exists public.osmaps_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  routes_seen integer,
  routes_downloaded integer,
  walks_matched integer,
  error text
);

alter table public.osmaps_sync_runs enable row level security;
revoke all on public.osmaps_sync_runs from anon, authenticated;

-- A leader removed an automatic match: don't attach that route to that walk again.
create table if not exists public.event_route_dismissals (
  event_suu_id text not null,
  osmaps_route_id text not null,
  dismissed_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (event_suu_id, osmaps_route_id)
);

alter table public.event_route_dismissals enable row level security;
revoke all on public.event_route_dismissals from anon, authenticated;
