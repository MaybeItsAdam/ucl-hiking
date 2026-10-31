-- Club routes, marked in the app. The Routes tab lists the club's own routes:
-- those named "… [CLUB]" in OS Maps, and those the committee marks here, so
-- nobody has to rename hundreds of routes in OS Maps. The OS Maps sync and the
-- bulk import only write the columns they read from OS Maps, so a mark made
-- here survives every sync.

alter table public.osmaps_routes
  add column if not exists club boolean not null default false,
  add column if not exists club_marked_by text,
  add column if not exists club_marked_at timestamptz;
