-- Borrowers report a problem with kit they have, or just had, on loan.
--
-- A report is against one loan (equipment_requests), and through it one kit
-- type. If tagged items went out on that loan, the borrower can name which one;
-- the item reference goes null if the item is later deleted, and the report
-- stays. A principal resolves it, optionally re-grading the item: that goes
-- through the item's own 'flag' action (equipment_item_apply), so the item's
-- event log stays its one history. This table only says what was reported and
-- when it was dealt with.
--
-- Account deletion (20260929000000) is unaffected: a report never blocks it,
-- and its reporter and resolver go null with the member.
--
-- RLS on, no policies: only the server, with the service role, reads these.

create table if not exists public.equipment_condition_reports (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.equipment_requests(id) on delete cascade,
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  item_id uuid references public.equipment_items(id) on delete set null,
  reporter_member_id uuid references public.members(id) on delete set null,
  severity text not null check (severity in ('minor', 'needs_repair', 'unusable')),
  description text not null check (char_length(btrim(description)) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by_member_id uuid references public.members(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  created_at timestamptz not null default now(),
  -- A resolved report says when; an open one doesn't.
  constraint equipment_condition_reports_resolved_when check ((status = 'resolved') = (resolved_at is not null))
);

create index if not exists equipment_condition_reports_open_idx
  on public.equipment_condition_reports (created_at desc) where status = 'open';
create index if not exists equipment_condition_reports_item_open_idx
  on public.equipment_condition_reports (item_id) where status = 'open' and item_id is not null;
create index if not exists equipment_condition_reports_request_idx
  on public.equipment_condition_reports (request_id);

alter table public.equipment_condition_reports enable row level security;

revoke all on public.equipment_condition_reports from anon, authenticated;
