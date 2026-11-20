-- Alumni sign in with their @alumni.ucl.ac.uk address, which isn't the
-- student address on their old members row, so sign-in couldn't find them.
--
-- alumni_email: the alumni address that leads to this grant. Sign-in fills it
-- in when it links an alumni address to a former member by itself (same UCL
-- login, or the same name before the @ on ucl.ac.uk); a principal types it in
-- when it can't.
--
-- source: 'granted' by a principal, or 'auto' when sign-in linked a former
-- member on its own.
--
-- revoked_at: a principal taking access away now keeps the row and stamps it,
-- rather than deleting it, so the next sign-in doesn't quietly link them again.
alter table public.alumni
  add column if not exists alumni_email text,
  add column if not exists source text not null default 'granted',
  add column if not exists revoked_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'alumni_alumni_email_key') then
    alter table public.alumni add constraint alumni_alumni_email_key unique (alumni_email);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'alumni_alumni_email_check') then
    alter table public.alumni add constraint alumni_alumni_email_check
      check (alumni_email is null or (alumni_email = lower(alumni_email) and alumni_email ~ '^[^@[:space:]]+@alumni\.ucl\.ac\.uk$'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'alumni_source_check') then
    alter table public.alumni add constraint alumni_source_check check (source in ('granted', 'auto'));
  end if;
end $$;
