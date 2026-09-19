-- What the members' Events tab shows beyond a title and time. All four come from
-- Adam's Campus Toolbox (webhook deliveries and the daily reconcile); rows the SU
-- sync job writes leave them null.
--
-- `source` marks rows the Toolbox owns, so the reconcile only ever deletes its own
-- rows and never an SU-synced one that happens to be missing from the Toolbox feed.
alter table public.events
  add column if not exists description text,
  add column if not exists location_url text,
  add column if not exists image_url text,
  add column if not exists is_all_day boolean not null default false,
  add column if not exists source text;

create index if not exists events_source_idx on public.events (source);
