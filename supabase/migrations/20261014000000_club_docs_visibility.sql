-- Who besides the committee can read a handbook page. Only the committee ever
-- writes one; existing pages stay committee-only.
alter table public.club_docs
  add column if not exists visibility text not null default 'committee'
    check (visibility in ('committee', 'walk_leaders', 'members'));
