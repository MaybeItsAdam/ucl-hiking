-- Kit custody: a request becomes a booked pickup, every change of hands is
-- recorded, and some kit only some people may take out.
--
-- A loan (equipment_requests) now runs
--
--   pending ──book──▶ booked ──first item handed over──▶ approved ──▶ returned
--      │                 │                                   │
--      └─▶ rejected / cancelled ◀─┘                          └─▶ cancelled (principal)
--
-- * pending: a member asked for kit.
-- * booked (new): a committee member has arranged to meet them to collect it,
--   with a time (pickup_at), a place (pickup_location) and who they're meeting
--   (pickup_with_member_id). Stock is held from here, so two bookings can't
--   promise the same tent.
-- * approved: the kit is with the member ("out"). The value is kept, not
--   renamed, because the account-deletion guard, the stock trigger, the
--   loan-closed stamp and the Sheets ledger all read it as "kit is out", and
--   that is still exactly what it means. Handing over the first tagged item
--   against a booked loan moves it here (equipment_items_mark_loan_out);
--   untagged kit is marked handed over by hand.
-- * A committee member can also take an item off the shelf straight to someone
--   with no request first (origin 'direct'): equipment_item_hand_out() writes
--   an already-out loan of one and the handover together.
--
-- Custody. equipment_items.holder_member_id is who has the item now: the
-- borrower when it leaves storage, then whoever it is passed to (A hands a tent
-- to B on a trip). The loan stays the borrower's, so stock and the return still
-- run through it; the holder says whose hands it is in. Every change of hands
-- is an equipment_item_events row with from_member_id / to_member_id:
-- check_out (storage → member), handover (member → member, new), check_in
-- (member → storage). Nobody holding club kit can delete their account.
--
-- Restricted kit. equipment.restricted_to lists the governance roles that may
-- take a kind of kit out (null: anyone who can borrow). The database refuses to
-- put a restricted item in the hands of anyone else ('restricted_item'),
-- whichever code path tries. The rule for drones (principals and admins only)
-- lives here too, as a trigger on equipment, so it holds for kit added in the
-- app, pulled in from Google Sheets or loaded by a script; the sheet pull never
-- writes restricted_to, so a restriction set in the app survives a sync.
--
-- Existing loans: approved loans stay approved (out). Items out on a loan get
-- the borrower as holder, and past check-outs and check-ins get the borrower as
-- their to/from, so the history reads the same as new events.
--
-- Data fix (the roll mat that "wouldn't take a third tag"): item RADIO-06 is a
-- radio that was tagged under "Roll mat" by picking the neighbouring type in the
-- list, so Roll mat counted 3 of 3 tagged while only ROLL-MAT-01 and -02 looked
-- like roll mats. It is moved to Radio, with an event saying so. Matched on id,
-- code and both type names, so it does nothing anywhere else.

-- ---------------------------------------------------------------------------
-- 1. Restricted kit
-- ---------------------------------------------------------------------------

alter table public.equipment
  add column if not exists restricted_to public.governance_role[];

alter table public.equipment drop constraint if exists equipment_restricted_to_not_empty;
alter table public.equipment
  add constraint equipment_restricted_to_not_empty
  check (restricted_to is null or cardinality(restricted_to) > 0);

-- Kit that is always restricted, by name. A drone with no restriction gets
-- principals and admins; one restricted some other way keeps that.
create or replace function public.equipment_default_restriction() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.restricted_to is null and new.name ~* '\mdrones?\M' then
    new.restricted_to := array['principal', 'admin']::public.governance_role[];
  end if;
  return new;
end;
$$;

drop trigger if exists equipment_default_restriction on public.equipment;
create trigger equipment_default_restriction
  before insert or update of name, restricted_to on public.equipment
  for each row execute function public.equipment_default_restriction();

update public.equipment
   set restricted_to = array['principal', 'admin']::public.governance_role[]
 where restricted_to is null
   and name ~* '\mdrones?\M';

-- ---------------------------------------------------------------------------
-- 2. Requests: booked pickups and direct hand-outs
-- ---------------------------------------------------------------------------

alter table public.equipment_requests
  add column if not exists pickup_at timestamptz,
  add column if not exists pickup_location text,
  add column if not exists pickup_with_member_id uuid references public.members(id) on delete set null,
  add column if not exists booked_by uuid references public.members(id) on delete set null,
  add column if not exists booked_at timestamptz,
  add column if not exists origin text not null default 'request';

alter table public.equipment_requests drop constraint if exists equipment_requests_origin_check;
alter table public.equipment_requests
  add constraint equipment_requests_origin_check check (origin in ('request', 'direct'));

alter table public.equipment_requests drop constraint if exists equipment_requests_status_check;
alter table public.equipment_requests
  add constraint equipment_requests_status_check
  check (status in ('pending', 'booked', 'approved', 'rejected', 'returned', 'cancelled'));

-- A booking says when.
alter table public.equipment_requests drop constraint if exists equipment_requests_booked_has_pickup;
alter table public.equipment_requests
  add constraint equipment_requests_booked_has_pickup
  check (status <> 'booked' or pickup_at is not null);

create index if not exists equipment_requests_pickup_with_idx
  on public.equipment_requests (pickup_with_member_id, pickup_at)
  where status = 'booked';

-- Stock is held while a loan is booked or out. Moving between the two leaves
-- it alone; entering either takes it, leaving both gives it back. A direct
-- hand-out is inserted already out, so this runs on insert too.
create or replace function public.move_kit_stock() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_available integer;
  v_new_holds boolean := new.status in ('booked', 'approved');
  v_old_holds boolean := tg_op = 'UPDATE' and old.status in ('booked', 'approved');
begin
  if v_new_holds and not v_old_holds then
    update public.equipment
       set available_quantity = available_quantity - new.quantity
     where id = new.equipment_id
       and available_quantity >= new.quantity
    returning available_quantity into v_available;
    if not found then
      select available_quantity into v_available from public.equipment where id = new.equipment_id;
      raise exception 'insufficient_stock'
        using errcode = 'P0001',
              detail = format('available=%s requested=%s', coalesce(v_available, 0), new.quantity);
    end if;
  elsif v_old_holds and not v_new_holds then
    update public.equipment
       set available_quantity = least(total_quantity, available_quantity + old.quantity)
     where id = old.equipment_id;
  end if;
  return new;
end;
$$;

drop trigger if exists equipment_requests_move_stock on public.equipment_requests;
create trigger equipment_requests_move_stock
  after insert or update of status on public.equipment_requests
  for each row execute function public.move_kit_stock();

-- ---------------------------------------------------------------------------
-- 3. Custody on items and events
-- ---------------------------------------------------------------------------

alter table public.equipment_items
  add column if not exists holder_member_id uuid references public.members(id) on delete set null;

alter table public.equipment_items drop constraint if exists equipment_items_holder_only_when_out;
alter table public.equipment_items
  add constraint equipment_items_holder_only_when_out
  check (holder_member_id is null or status = 'on_loan');

create index if not exists equipment_items_holder_idx
  on public.equipment_items (holder_member_id) where holder_member_id is not null;

alter table public.equipment_item_events
  add column if not exists from_member_id uuid references public.members(id) on delete set null,
  add column if not exists to_member_id uuid references public.members(id) on delete set null;

alter table public.equipment_item_events drop constraint if exists equipment_item_events_action_check;
alter table public.equipment_item_events
  add constraint equipment_item_events_action_check
  check (action in ('tagged', 'check_out', 'handover', 'check_in', 'audit', 'flag'));

-- Backfill, without bumping updated_at (the app's stale-read check).
alter table public.equipment_items disable trigger equipment_items_set_updated_at;
update public.equipment_items i
   set holder_member_id = r.member_id
  from public.equipment_requests r
 where i.loan_request_id = r.id
   and i.status = 'on_loan'
   and i.holder_member_id is null;
alter table public.equipment_items enable trigger equipment_items_set_updated_at;

update public.equipment_item_events e
   set to_member_id = r.member_id
  from public.equipment_requests r
 where e.request_id = r.id
   and e.action = 'check_out'
   and e.to_member_id is null;

update public.equipment_item_events e
   set from_member_id = r.member_id
  from public.equipment_requests r
 where e.request_id = r.id
   and e.action = 'check_in'
   and e.from_member_id is null;

-- The item guard (20261007000000), plus: a loan can take items while booked or
-- out, and a restricted item only goes to someone whose role is allowed.
create or replace function public.guard_equipment_item() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_total integer;
  v_count integer;
  v_req record;
  v_restricted public.governance_role[];
  v_role public.governance_role;
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
    if not found or v_req.status not in ('booked', 'approved') then
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

  if new.holder_member_id is not null
     and (tg_op = 'INSERT'
          or new.holder_member_id is distinct from old.holder_member_id
          or new.equipment_id is distinct from old.equipment_id) then
    select restricted_to into v_restricted from public.equipment where id = new.equipment_id;
    if v_restricted is not null then
      select governance_role into v_role from public.members where id = new.holder_member_id;
      if v_role is null or not (v_role = any (v_restricted)) then
        raise exception 'restricted_item'
          using errcode = 'P0001',
                detail = format('allowed=%s', array_to_string(v_restricted, ','));
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists equipment_items_guard on public.equipment_items;
create trigger equipment_items_guard
  before insert or update of equipment_id, loan_request_id, holder_member_id on public.equipment_items
  for each row execute function public.guard_equipment_item();

-- The first item handed over against a booked loan means the kit is out.
create or replace function public.mark_loan_out() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.loan_request_id is not null
     and (tg_op = 'INSERT' or new.loan_request_id is distinct from old.loan_request_id) then
    update public.equipment_requests
       set status = 'approved'
     where id = new.loan_request_id
       and status = 'booked';
  end if;
  return new;
end;
$$;

drop trigger if exists equipment_items_mark_loan_out on public.equipment_items;
create trigger equipment_items_mark_loan_out
  after insert or update of loan_request_id on public.equipment_items
  for each row execute function public.mark_loan_out();

-- A scan (20261007000000), now carrying who had the item and who has it next.
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
  insert into public.equipment_item_events (
    item_id, action, request_id, actor_member_id, from_member_id, to_member_id, at, client_id, location, condition, notes
  )
  values (
    p_item_id,
    p_event->>'action',
    nullif(p_event->>'request_id', '')::uuid,
    nullif(p_event->>'actor_member_id', '')::uuid,
    nullif(p_event->>'from_member_id', '')::uuid,
    nullif(p_event->>'to_member_id', '')::uuid,
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
           holder_member_id = case when p_patch ? 'holder_member_id' then (p_patch->>'holder_member_id')::uuid else holder_member_id end,
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

-- Straight off the shelf to someone, with no request first: an already-out
-- loan of one, the item on it in their hands, and the check-out event, in one
-- transaction. Idempotent on the event's client_id.
--
-- p_loan: {member_id, start_date, end_date, purpose, actor_member_id}
-- p_event: {client_id, at, actor_member_id, notes}
-- Returns {"status": "applied" | "duplicate", "item_id": uuid, "request_id": uuid}.
create or replace function public.equipment_item_hand_out(
  p_item_id uuid,
  p_expected timestamptz,
  p_loan jsonb,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id text := nullif(p_event->>'client_id', '');
  v_item record;
  v_request_id uuid;
  v_member uuid := (p_loan->>'member_id')::uuid;
  v_actor uuid := nullif(p_loan->>'actor_member_id', '')::uuid;
  v_prior record;
begin
  if v_client_id is not null then
    select item_id, request_id into v_prior from public.equipment_item_events where client_id = v_client_id;
    if found then
      return jsonb_build_object('status', 'duplicate', 'item_id', v_prior.item_id, 'request_id', v_prior.request_id);
    end if;
  end if;

  select id, equipment_id, status, updated_at into v_item
    from public.equipment_items
   where id = p_item_id
     for update;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0001';
  end if;
  if (p_expected is not null and v_item.updated_at <> p_expected) or v_item.status not in ('available', 'missing') then
    raise exception 'stale_item' using errcode = 'P0001';
  end if;

  insert into public.equipment_requests (
    member_id, equipment_id, quantity, start_date, end_date, purpose, status, origin,
    reviewed_by, reviewed_at, booked_by, booked_at, pickup_at, pickup_with_member_id
  )
  values (
    v_member,
    v_item.equipment_id,
    1,
    (p_loan->>'start_date')::date,
    (p_loan->>'end_date')::date,
    coalesce(nullif(p_loan->>'purpose', ''), 'Handed over in person'),
    'approved',
    'direct',
    v_actor, now(), v_actor, now(), now(), v_actor
  )
  returning id into v_request_id;

  update public.equipment_items
     set status = 'on_loan',
         loan_request_id = v_request_id,
         holder_member_id = v_member
   where id = p_item_id;

  insert into public.equipment_item_events (
    item_id, action, request_id, actor_member_id, to_member_id, at, client_id, notes
  )
  values (
    p_item_id,
    'check_out',
    v_request_id,
    nullif(p_event->>'actor_member_id', '')::uuid,
    v_member,
    least(coalesce(nullif(p_event->>'at', '')::timestamptz, now()), now()),
    v_client_id,
    nullif(p_event->>'notes', '')
  );

  return jsonb_build_object('status', 'applied', 'item_id', p_item_id, 'request_id', v_request_id);
end;
$$;

revoke all on function public.equipment_default_restriction() from public, anon, authenticated;
revoke all on function public.move_kit_stock() from public, anon, authenticated;
revoke all on function public.guard_equipment_item() from public, anon, authenticated;
revoke all on function public.mark_loan_out() from public, anon, authenticated;
revoke all on function public.equipment_item_apply(uuid, timestamptz, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.equipment_item_hand_out(uuid, timestamptz, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.equipment_item_apply(uuid, timestamptz, jsonb, jsonb) to service_role;
grant execute on function public.equipment_item_hand_out(uuid, timestamptz, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Account deletion (20260929000000): a booking is cancelled like a pending
--    request, and holding an item counts as having kit out.
-- ---------------------------------------------------------------------------

create or replace function public.guard_member_delete() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_out integer;
  v_held integer;
begin
  perform 1 from public.equipment_requests where member_id = old.id for update;
  perform 1 from public.equipment_items where holder_member_id = old.id for update;

  select count(*) into v_out
    from public.equipment_requests
   where member_id = old.id
     and status = 'approved';
  select count(*) into v_held
    from public.equipment_items
   where holder_member_id = old.id;
  if v_out > 0 or v_held > 0 then
    raise exception 'member % still has club kit out (% loan(s), % item(s) in hand)', old.id, v_out, v_held
      using errcode = 'restrict_violation',
            hint = 'Check the kit in before deleting this member.';
  end if;

  update public.equipment_requests
     set status = case when status in ('pending', 'booked') then 'cancelled' else status end,
         notes = case
                   when status in ('pending', 'booked')
                     then concat_ws(E'\n', nullif(notes, ''), 'Cancelled automatically: the member deleted their account.')
                   else notes
                 end,
         borrower_name = coalesce(borrower_name, old.full_name),
         borrower_email = coalesce(borrower_email, old.email::text)
   where member_id = old.id;

  return old;
end;
$$;

create or replace function public.delete_member_account(p_member_id uuid, p_cool_off_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := greatest(coalesce(p_cool_off_days, 0), 0);
  v_items jsonb;
  v_until timestamptz;
  v_cancelled integer;
begin
  perform 1 from public.members where id = p_member_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  perform 1 from public.equipment_requests where member_id = p_member_id for update;
  perform 1 from public.equipment_items where holder_member_id = p_member_id for update;

  -- Their loans that are out, and items passed to them on someone else's loan.
  select coalesce(jsonb_agg(x.item order by x.end_date, x.id), '[]'::jsonb)
    into v_items
    from (
      select r.id, r.end_date,
             jsonb_build_object('id', r.id, 'name', coalesce(e.name, 'Club kit'), 'quantity', r.quantity, 'end_date', r.end_date) as item
        from public.equipment_requests r
        left join public.equipment e on e.id = r.equipment_id
       where r.member_id = p_member_id
         and r.status = 'approved'
      union all
      select i.id, r.end_date,
             jsonb_build_object('id', i.id, 'name', concat_ws(' ', coalesce(e.name, 'Club kit'), i.asset_code), 'quantity', 1, 'end_date', r.end_date)
        from public.equipment_items i
        left join public.equipment e on e.id = i.equipment_id
        left join public.equipment_requests r on r.id = i.loan_request_id
       where i.holder_member_id = p_member_id
         and (r.member_id is distinct from p_member_id or r.status is distinct from 'approved')
    ) x;
  if jsonb_array_length(v_items) > 0 then
    return jsonb_build_object('status', 'on_loan', 'items', v_items);
  end if;

  if v_days > 0 then
    select coalesce(
             jsonb_agg(
               jsonb_build_object('id', r.id, 'name', coalesce(e.name, 'Club kit'), 'quantity', r.quantity, 'closed_at', r.loan_closed_at)
               order by r.loan_closed_at desc, r.id
             ),
             '[]'::jsonb
           ),
           max(r.loan_closed_at) + make_interval(days => v_days)
      into v_items, v_until
      from public.equipment_requests r
      left join public.equipment e on e.id = r.equipment_id
     where r.member_id = p_member_id
       and r.loan_closed_at > now() - make_interval(days => v_days);
    if v_until is not null then
      return jsonb_build_object('status', 'cooling_off', 'until', v_until, 'items', v_items);
    end if;
  end if;

  update public.equipment_requests
     set status = 'cancelled',
         notes = concat_ws(E'\n', nullif(notes, ''), 'Cancelled automatically: the member deleted their account.')
   where member_id = p_member_id
     and status in ('pending', 'booked');
  get diagnostics v_cancelled = row_count;

  update public.audit_log
     set metadata = '{}'::jsonb
   where target_type = 'member'
     and target_id = p_member_id::text
     and action like 'auth.%';

  delete from public.members where id = p_member_id;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, metadata)
  values (null, 'account.self_delete', 'member', p_member_id::text, jsonb_build_object('cancelled_requests', v_cancelled));

  return jsonb_build_object('status', 'deleted', 'cancelled_requests', v_cancelled);
end;
$$;

revoke all on function public.delete_member_account(uuid, integer) from public, anon, authenticated;
grant execute on function public.delete_member_account(uuid, integer) to service_role;
revoke all on function public.guard_member_delete() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Data fix: RADIO-06 was tagged under Roll mat by mistake
-- ---------------------------------------------------------------------------

with moved as (
  update public.equipment_items i
     set equipment_id = radio.id
    from public.equipment radio, public.equipment mat
   where i.id = 'c4d4a788-6a7f-4342-a545-2aff21eed9aa'
     and i.asset_code = 'RADIO-06'
     and i.status <> 'on_loan'
     and mat.id = i.equipment_id
     and mat.name = 'Roll mat'
     and radio.id = '69556bb0-c905-4c5b-b5e6-21d5c74e16da'
     and radio.name = 'Radio'
  returning i.id
)
insert into public.equipment_item_events (item_id, action, at, notes)
select id, 'audit', now(), 'Moved from Roll mat to Radio: it was tagged under the wrong kit type.'
  from moved;
