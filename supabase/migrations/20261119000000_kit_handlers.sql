-- Members a principal has let scan tagged kit by hand: hand it over against an
-- approved loan, take it back, tag it and audit the shelf. Committee, principals
-- and admins can already, by role; this is for anyone else (a kit officer who
-- isn't on the committee). Approving loans and editing inventory stay with the
-- principals either way.
--
-- Its own table rather than a members column, so the sign-in lookup never
-- depends on this migration having run, and the member sync never touches it.
create table if not exists public.kit_handlers (
  member_id uuid primary key references public.members(id) on delete cascade,
  granted_by uuid references public.members(id) on delete set null,
  granted_at timestamptz not null default now()
);

-- RLS on, no policies: only the server, with the service role, reads these.
alter table public.kit_handlers enable row level security;
revoke all on public.kit_handlers from anon, authenticated;
