-- Committee tools: trip money, the handbook, and membership tier history for
-- the taster-conversion stat.

create table if not exists public.event_finance_lines (
  id uuid primary key default gen_random_uuid(),
  event_suu_id text not null,
  kind text not null check (kind in ('income', 'expense')),
  label text not null,
  amount_pence integer not null check (amount_pence >= 0),
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists event_finance_lines_event_idx on public.event_finance_lines (event_suu_id);

create table if not exists public.club_docs (
  slug text primary key check (slug ~ '^[a-z0-9-]{1,60}$'),
  title text not null,
  body text not null default '',
  updated_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.club_docs (slug, title, body) values
  ('risk-assessments', 'Risk assessments', ''),
  ('transport-contacts', 'Coach & transport contacts', ''),
  ('handover', 'Handover', '')
on conflict (slug) do nothing;

-- Every change of tier, whoever makes it (sync job, Toolbox, sign-in), so the
-- committee can see tasters becoming members. Accurate from this migration on.
create table if not exists public.member_tier_history (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  from_tier public.membership_tier,
  to_tier public.membership_tier not null,
  changed_at timestamptz not null default now()
);

create index if not exists member_tier_history_member_idx on public.member_tier_history (member_id);
create index if not exists member_tier_history_changed_idx on public.member_tier_history (changed_at);

create or replace function public.record_tier_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.member_tier_history (member_id, from_tier, to_tier) values (new.id, null, new.membership_tier);
  elsif new.membership_tier is distinct from old.membership_tier then
    insert into public.member_tier_history (member_id, from_tier, to_tier) values (new.id, old.membership_tier, new.membership_tier);
  end if;
  return new;
end;
$$;

drop trigger if exists members_record_tier_change on public.members;
create trigger members_record_tier_change after insert or update of membership_tier on public.members
  for each row execute function public.record_tier_change();

alter table public.event_finance_lines enable row level security;
alter table public.club_docs enable row level security;
alter table public.member_tier_history enable row level security;
revoke all on public.event_finance_lines from anon, authenticated;
revoke all on public.club_docs from anon, authenticated;
revoke all on public.member_tier_history from anon, authenticated;

create trigger club_docs_set_updated_at before update on public.club_docs
  for each row execute function public.set_updated_at();
