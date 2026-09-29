-- A walk's route as GPX, attached by its leader: an uploaded .gpx file or a
-- direct GPX link the server fetched. Parsed and thinned on the way in, so this
-- holds a few thousand points of JSON, never the raw file.
--
-- Its own table rather than columns on event_plans: plan reads (lists, the
-- rota) stay small, and saving the plan form never overwrites the route.
-- Keyed by the SU id for the same reason as event_plans.

create table if not exists public.event_routes (
  event_suu_id text primary key,
  name text,
  source_file text,
  source_url text,
  distance_m integer not null check (distance_m >= 0),
  ascent_m integer check (ascent_m >= 0),
  descent_m integer check (descent_m >= 0),
  -- [[[lat, lng, ele?], ...], ...]: one array per unbroken track segment.
  segments jsonb not null,
  -- [{lat, lng, name}, ...]
  waypoints jsonb not null default '[]'::jsonb,
  updated_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.event_routes enable row level security;
revoke all on public.event_routes from anon, authenticated;

create trigger event_routes_set_updated_at before update on public.event_routes
  for each row execute function public.set_updated_at();
