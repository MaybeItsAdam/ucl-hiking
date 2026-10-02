-- The club's programme comes from its Google Sheets (see src/lib/walkSheet.ts).
--
-- One row per event on the committee calendar. The sheet stays the record of
-- what a walk *is*; this keeps the app's own say about it (published, who can
-- see it, which SU event it is) and enough of the sheet to merge edits made in
-- both places: `base` is the last value both sides agreed on, per field.

create table if not exists public.sheet_walks (
  id uuid primary key default gen_random_uuid(),
  -- The developer-metadata tag on the calendar row; moves with the row.
  row_key text not null unique,
  sheet_row integer,
  planning_row integer,
  signup_row integer,
  starts_on date,
  title text not null,
  kind text not null default 'other',
  -- Editable fields as last read from the sheet, and as last agreed.
  sheet_values jsonb not null default '{}'::jsonb,
  base jsonb not null default '{}'::jsonb,
  -- Worked-out columns (status, meeting time, ticket cost…), for display.
  shown jsonb not null default '{}'::jsonb,
  -- field → { sheet, app, by, at }: both sides changed it differently.
  conflicts jsonb not null default '{}'::jsonb,
  event_suu_id text,
  link_source text check (link_source in ('auto', 'manual')),
  published boolean not null default false,
  -- 'sheet' follows the STATUS column ("PUBLISHED ✅"); 'app' once the committee flips it.
  published_source text not null default 'sheet' check (published_source in ('sheet', 'app')),
  visibility text not null default 'taster'
    check (visibility in ('public', 'taster', 'member', 'explorer', 'leaders', 'committee')),
  -- 'sheet' follows the MEMBERSHIP column; 'app' once the committee picks.
  visibility_source text not null default 'sheet' check (visibility_source in ('sheet', 'app')),
  present boolean not null default true,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sheet_walks_starts_on_idx on public.sheet_walks (starts_on);
create unique index if not exists sheet_walks_event_idx on public.sheet_walks (event_suu_id) where event_suu_id is not null and present;

alter table public.sheet_walks enable row level security;
revoke all on public.sheet_walks from anon, authenticated;

drop trigger if exists sheet_walks_set_updated_at on public.sheet_walks;
create trigger sheet_walks_set_updated_at before update on public.sheet_walks
  for each row execute function public.set_updated_at();

create table if not exists public.sheet_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text,
  ok boolean,
  walks_seen integer,
  walks_changed integer,
  conflicts integer,
  error text
);

alter table public.sheet_sync_runs enable row level security;
revoke all on public.sheet_sync_runs from anon, authenticated;

-- Walk leaders come from the WL roster tab; it names them as the calendar does.
alter table public.members
  add column if not exists wl_name text,
  add column if not exists first_aid_trained boolean not null default false,
  add column if not exists first_aid_until date;
