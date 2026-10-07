-- NFC-tagged club kit: one row per physical item, under its equipment type.
--
-- `equipment` stays the count of each kind of kit, and loans stay requests for
-- N of a type: approving one still counts stock out, returning it restores it
-- (trigger equipment_requests_move_stock). Tagging adds a layer on top for the
-- kit that has a tag: which tent went to whom, scanned at the handover.
-- Untagged stock keeps working as plain counts.
--
-- The rules the database holds, whichever code path writes:
-- 1. A type never has more tagged items than its total_quantity. Checked on the
--    item insert (and on a move between types), and when a type's total is
--    lowered, both under the equipment row's lock so two taggings at once can't
--    both squeeze past. Error 'item_limit'.
-- 2. An item is only handed over against an approved request for its own type,
--    and a request never has more items out than its quantity. Checked under
--    the request row's lock. Errors 'loan_not_approved', 'loan_wrong_type',
--    'loan_full'.
-- 3. Every scan is an equipment_item_events row. `client_id` is the phone's
--    offline-queue key, unique, so a replayed scan is recognised.
--
-- Account deletion (20260929000000) is unaffected: items reference requests,
-- never members; a request is never deleted while a member is (its member_id
-- goes null), and the event's actor goes null with the member.
--
-- RLS on, no policies: only the server, with the service role, reads these.

create table if not exists public.equipment_items (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  -- Canonical form: uppercase hex bytes joined by colons, 4 to 10 bytes.
  tag_uid text unique check (tag_uid ~ '^([0-9A-F]{2}:){3,9}[0-9A-F]{2}$'),
  asset_code text not null unique check (asset_code ~ '^[A-Z0-9][A-Z0-9-]{0,39}$'),
  label text,
  location text,
  status text not null default 'available' check (status in ('available', 'on_loan', 'maintenance', 'missing')),
  condition text not null default 'good' check (condition in ('good', 'fair', 'needs_repair')),
  loan_request_id uuid references public.equipment_requests(id) on delete set null,
  last_audited_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Only an item on loan points at a request. (Not the converse: if a request
  -- row is ever deleted the item keeps 'on_loan' with no request, and scanning
  -- it back in clears it.)
  constraint equipment_items_loan_only_when_out check (loan_request_id is null or status = 'on_loan')
);

create index if not exists equipment_items_equipment_idx on public.equipment_items (equipment_id);
create index if not exists equipment_items_loan_idx on public.equipment_items (loan_request_id) where loan_request_id is not null;

create table if not exists public.equipment_item_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.equipment_items(id) on delete cascade,
  action text not null check (action in ('tagged', 'check_out', 'check_in', 'audit', 'flag')),
  request_id uuid references public.equipment_requests(id) on delete set null,
  actor_member_id uuid references public.members(id) on delete set null,
  -- When it happened on the phone (clamped to not be in the future).
  at timestamptz not null,
  client_id text unique,
  location text,
  condition text check (condition is null or condition in ('good', 'fair', 'needs_repair')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists equipment_item_events_item_idx on public.equipment_item_events (item_id, at desc);
create index if not exists equipment_item_events_request_idx on public.equipment_item_events (request_id) where request_id is not null;

alter table public.equipment_items enable row level security;
alter table public.equipment_item_events enable row level security;

revoke all on public.equipment_items from anon, authenticated;
revoke all on public.equipment_item_events from anon, authenticated;

drop trigger if exists equipment_items_set_updated_at on public.equipment_items;
create trigger equipment_items_set_updated_at before update on public.equipment_items
for each row execute function public.set_updated_at();

-- 1 and 2: the caps.
create or replace function public.guard_equipment_item() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_total integer;
  v_count integer;
  v_req record;
begin
  if tg_op = 'INSERT' or new.equipment_id is distinct from old.equipment_id then
    select total_quantity into v_total
      from public.equipment
     where id = new.equipment_id
       for no key update;
    select count(*) into v_count
      from public.equipment_items
     where equipment_id = new.equipment_id
       and id <> new.id;
    if v_count + 1 > coalesce(v_total, 0) then
      raise exception 'item_limit'
        using errcode = 'P0001',
              detail = format('total=%s tagged=%s', coalesce(v_total, 0), v_count);
    end if;
  end if;

  if new.loan_request_id is not null
     and (tg_op = 'INSERT' or new.loan_request_id is distinct from old.loan_request_id) then
    select status, quantity, equipment_id into v_req
      from public.equipment_requests
     where id = new.loan_request_id
       for no key update;
    if not found or v_req.status <> 'approved' then
      raise exception 'loan_not_approved' using errcode = 'P0001';
    end if;
    if v_req.equipment_id <> new.equipment_id then
      raise exception 'loan_wrong_type' using errcode = 'P0001';
    end if;
    select count(*) into v_count
      from public.equipment_items
     where loan_request_id = new.loan_request_id
       and id <> new.id;
    if v_count + 1 > v_req.quantity then
      raise exception 'loan_full'
        using errcode = 'P0001',
              detail = format('quantity=%s out=%s', v_req.quantity, v_count);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists equipment_items_guard on public.equipment_items;
create trigger equipment_items_guard
  before insert or update of equipment_id, loan_request_id on public.equipment_items
  for each row execute function public.guard_equipment_item();

-- 1, the other side: a type's total can't drop below the items tagged under it.
create or replace function public.guard_equipment_total() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if new.total_quantity < old.total_quantity then
    select count(*) into v_count from public.equipment_items where equipment_id = new.id;
    if v_count > new.total_quantity then
      raise exception 'item_limit'
        using errcode = 'P0001',
              detail = format('total=%s tagged=%s', new.total_quantity, v_count);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists equipment_guard_total on public.equipment;
create trigger equipment_guard_total
  before update of total_quantity on public.equipment
  for each row execute function public.guard_equipment_total();

-- 3. A scan: the event and the item change in one transaction, idempotent on
-- the event's client_id, and only if the item is still as the app read it
-- (p_expected = its updated_at), so two phones can't both act on a stale read.
--
-- Returns {"status": "applied" | "duplicate", "item_id": uuid}. Raises
-- 'stale_item' if the item changed meanwhile, or a guard error above.
create or replace function public.equipment_item_apply(
  p_item_id uuid,
  p_expected timestamptz,
  p_patch jsonb,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_client_id text := nullif(p_event->>'client_id', '');
  v_prior uuid;
begin
  insert into public.equipment_item_events (item_id, action, request_id, actor_member_id, at, client_id, location, condition, notes)
  values (
    p_item_id,
    p_event->>'action',
    nullif(p_event->>'request_id', '')::uuid,
    nullif(p_event->>'actor_member_id', '')::uuid,
    least(coalesce(nullif(p_event->>'at', '')::timestamptz, now()), now()),
    v_client_id,
    p_event->>'location',
    p_event->>'condition',
    p_event->>'notes'
  )
  on conflict (client_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select item_id into v_prior from public.equipment_item_events where client_id = v_client_id;
    return jsonb_build_object('status', 'duplicate', 'item_id', v_prior);
  end if;

  if p_patch is not null and p_patch <> '{}'::jsonb then
    update public.equipment_items
       set status = case when p_patch ? 'status' then p_patch->>'status' else status end,
           condition = case when p_patch ? 'condition' then p_patch->>'condition' else condition end,
           location = case when p_patch ? 'location' then p_patch->>'location' else location end,
           notes = case when p_patch ? 'notes' then p_patch->>'notes' else notes end,
           loan_request_id = case when p_patch ? 'loan_request_id' then (p_patch->>'loan_request_id')::uuid else loan_request_id end,
           last_audited_at = case
                               when p_patch ? 'last_audited_at'
                                 then least((p_patch->>'last_audited_at')::timestamptz, now())
                               else last_audited_at
                             end
     where id = p_item_id
       and (p_expected is null or updated_at = p_expected);
    if not found then
      raise exception 'stale_item' using errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object('status', 'applied', 'item_id', p_item_id);
end;
$$;

-- Commissioning: the item and its 'tagged' event together.
-- Returns {"status": "applied" | "duplicate", "item_id": uuid}.
create or replace function public.equipment_item_commission(p_item jsonb, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id text := nullif(p_event->>'client_id', '');
  v_item_id uuid;
  v_event_id uuid;
begin
  if v_client_id is not null then
    select item_id into v_item_id from public.equipment_item_events where client_id = v_client_id;
    if found then
      return jsonb_build_object('status', 'duplicate', 'item_id', v_item_id);
    end if;
  end if;

  insert into public.equipment_items (equipment_id, tag_uid, asset_code, label, location, notes)
  values (
    (p_item->>'equipment_id')::uuid,
    nullif(p_item->>'tag_uid', ''),
    p_item->>'asset_code',
    nullif(p_item->>'label', ''),
    nullif(p_item->>'location', ''),
    nullif(p_item->>'notes', '')
  )
  returning id into v_item_id;

  insert into public.equipment_item_events (item_id, action, actor_member_id, at, client_id, location)
  values (
    v_item_id,
    'tagged',
    nullif(p_event->>'actor_member_id', '')::uuid,
    least(coalesce(nullif(p_event->>'at', '')::timestamptz, now()), now()),
    v_client_id,
    nullif(p_item->>'location', '')
  )
  on conflict (client_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    -- The same scan landed from another request a moment ago; undo this copy.
    raise exception 'duplicate_client_id' using errcode = 'P0001';
  end if;

  return jsonb_build_object('status', 'applied', 'item_id', v_item_id);
end;
$$;

revoke all on function public.guard_equipment_item() from public, anon, authenticated;
revoke all on function public.guard_equipment_total() from public, anon, authenticated;
revoke all on function public.equipment_item_apply(uuid, timestamptz, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.equipment_item_commission(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.equipment_item_apply(uuid, timestamptz, jsonb, jsonb) to service_role;
grant execute on function public.equipment_item_commission(jsonb, jsonb) to service_role;
