-- Notifications: an in-app inbox for everyone, plus push to the phone app.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_member_idx on public.notifications (member_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (member_id) where read_at is null;

-- FCM registration tokens, one per installed app. Dropped when FCM says they're dead.
create table if not exists public.push_tokens (
  token text primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_tokens_member_idx on public.push_tokens (member_id);

-- Opt-outs per kind. No row means on.
create table if not exists public.notification_prefs (
  member_id uuid not null references public.members(id) on delete cascade,
  kind text not null,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (member_id, kind)
);

-- One reminder per person per walk, however many times the cron runs.
create table if not exists public.sent_reminders (
  key text primary key,
  sent_at timestamptz not null default now()
);

alter table public.notifications enable row level security;
alter table public.push_tokens enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.sent_reminders enable row level security;
revoke all on public.notifications from anon, authenticated;
revoke all on public.push_tokens from anon, authenticated;
revoke all on public.notification_prefs from anon, authenticated;
revoke all on public.sent_reminders from anon, authenticated;
