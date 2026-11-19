-- The photo archive and alumni access.
--
-- event_photo_albums: a Google Photos shared-album link the committee attach
-- to a trip. Google's Photos Library API no longer lets an app read someone's
-- library or albums it didn't create, so the app keeps the link and decides
-- who to show it to: a trip's album to the people on that trip, every album to
-- the committee. That is presentation, not access control: a shared-album link
-- opens for anyone it is forwarded to.
--
-- Keyed by events.suu_event_id, never events.id, like event_plans: Toolbox's
-- reconcile deletes and recreates event rows, which changes the uuid but
-- keeps the SU id.
create table if not exists public.event_photo_albums (
  event_suu_id text primary key,
  url text not null check (url ~ '^https://' and length(url) <= 500),
  updated_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.event_photo_albums enable row level security;
revoke all on public.event_photo_albums from anon, authenticated;

create trigger event_photo_albums_set_updated_at before update on public.event_photo_albums
  for each row execute function public.set_updated_at();

-- Former members a principal has let back in to read the Navigator and see the
-- photo albums of the trips they went on. Nothing else: once their membership
-- has lapsed (revoked by the sync, or expired) every other page and API still
-- turns them away, because those go through the current-member lookup.
--
-- Its own table rather than a members column, as kit_handlers is: the sign-in
-- lookup never depends on this migration having run, and the member sync,
-- which revokes and rewrites members rows, never touches it.
create table if not exists public.alumni (
  member_id uuid primary key references public.members(id) on delete cascade,
  granted_by uuid references public.members(id) on delete set null,
  granted_at timestamptz not null default now()
);

-- RLS on, no policies: only the server, with the service role, reads these.
alter table public.alumni enable row level security;
revoke all on public.alumni from anon, authenticated;
