-- Where the places named in walk posts are, for the event maps and the year map.
--
-- Keyed by the place as the post names it ("Seaford", "Boxhill & Westhumble"),
-- not by event: the same stations come round every term, and Toolbox's reconcile
-- deletes and recreates event rows, which would throw a per-event pin away.
--
-- The daily events reconcile fills it from OpenStreetMap's Nominatim. A null
-- latitude records a lookup that found nothing, so it is not repeated every day.
-- A wrong pin is fixed by editing its row here; `source = 'manual'` stops the
-- reconcile from ever looking that place up again.
create table if not exists public.place_geocodes (
  place text primary key,
  latitude double precision,
  longitude double precision,
  label text,
  source text not null default 'nominatim' check (source in ('nominatim', 'manual')),
  looked_up_at timestamptz not null default now()
);

alter table public.place_geocodes enable row level security;
