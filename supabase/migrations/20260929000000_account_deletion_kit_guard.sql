-- Deleting an account must never lose track of club kit.
--
-- Before this, `equipment_requests.member_id` cascaded on delete: a member who
-- deleted their account took the whole lending history with them, and the only
-- thing stopping someone with kit out was one query in the delete route, with a
-- gap between that check and the delete.
--
-- 1. History survives. The foreign key becomes ON DELETE SET NULL, and the
--    borrower's name and email are copied onto their requests as the member row
--    goes, so the ledger still says who had what. (Why not keep the member row
--    as an anonymised tombstone? `members` is the sign-in identity: its email is
--    unique, the member sync and roster read it, and every list of members
--    would have to learn to skip tombstones. The request row is where the
--    history lives, so the snapshot goes there.)
-- 2. An open request always has a borrower: a check constraint means a pending
--    or approved request can never end up with a null member_id, whichever code
--    path tries.
-- 3. A BEFORE DELETE trigger on members refuses to delete anyone with kit out
--    (status 'approved' — "overdue" is approved past its end date), and cancels
--    their pending requests. Any delete, from any code path or the SQL editor,
--    goes through it.
-- 4. `loan_closed_at` records when a loan stopped being out, so self-service
--    deletion can wait a few days after a return for a principal to check it.
-- 5. `delete_member_account()` does the self-service check and delete in one
--    transaction, holding a lock on the member so a new request or approval
--    can't land between the check and the delete.

-- 1. Keep lending history when a member is deleted.
alter table public.equipment_requests
  add column if not exists borrower_name text,
  add column if not exists borrower_email text,
  add column if not exists loan_closed_at timestamptz;

alter table public.equipment_requests alter column member_id drop not null;

do $$
declare
  fk record;
begin
  for fk in
    select c.conname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.conrelid = 'public.equipment_requests'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.members'::regclass
       and a.attname = 'member_id'
  loop
    execute format('alter table public.equipment_requests drop constraint %I', fk.conname);
  end loop;
end;
$$;

alter table public.equipment_requests
  add constraint equipment_requests_member_id_fkey
  foreign key (member_id) references public.members(id) on delete set null;

-- 2. Pending and approved requests always belong to someone.
alter table public.equipment_requests drop constraint if exists equipment_requests_open_has_borrower;
alter table public.equipment_requests
  add constraint equipment_requests_open_has_borrower
  check (member_id is not null or status in ('rejected', 'returned', 'cancelled'));

-- 4. When a loan stopped being out. Set on the way out of 'approved'; cleared if
--    a request is approved again.
create or replace function public.stamp_loan_closed() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'approved' and new.status is distinct from 'approved' then
    new.loan_closed_at := now();
  elsif new.status = 'approved' then
    new.loan_closed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists equipment_requests_stamp_loan_closed on public.equipment_requests;
create trigger equipment_requests_stamp_loan_closed
  before update of status on public.equipment_requests
  for each row execute function public.stamp_loan_closed();

-- Backfill from the review stamp (a principal marks a loan returned), without
-- bumping every returned row's updated_at.
alter table public.equipment_requests disable trigger equipment_requests_set_updated_at;
update public.equipment_requests
   set loan_closed_at = coalesce(reviewed_at, updated_at)
 where status = 'returned'
   and loan_closed_at is null;
alter table public.equipment_requests enable trigger equipment_requests_set_updated_at;

create index if not exists equipment_requests_loan_closed_idx
  on public.equipment_requests (member_id, loan_closed_at)
  where loan_closed_at is not null;

-- 3. No member is deleted with kit out, by any code path.
create or replace function public.guard_member_delete() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_out integer;
begin
  -- Lock their requests first so an approval can't land between the count and
  -- the delete. (One that does commit first is counted.)
  perform 1 from public.equipment_requests where member_id = old.id for update;

  select count(*) into v_out
    from public.equipment_requests
   where member_id = old.id
     and status = 'approved';
  if v_out > 0 then
    raise exception 'member % still has % club kit loan(s) out', old.id, v_out
      using errcode = 'restrict_violation',
            hint = 'Mark the kit returned before deleting this member.';
  end if;

  update public.equipment_requests
     set status = case when status = 'pending' then 'cancelled' else status end,
         notes = case
                   when status = 'pending'
                     then concat_ws(E'\n', nullif(notes, ''), 'Cancelled automatically: the member deleted their account.')
                   else notes
                 end,
         borrower_name = coalesce(borrower_name, old.full_name),
         borrower_email = coalesce(borrower_email, old.email::text)
   where member_id = old.id;

  return old;
end;
$$;

drop trigger if exists members_guard_delete on public.members;
create trigger members_guard_delete
  before delete on public.members
  for each row execute function public.guard_member_delete();

-- 5. Self-service deletion: check and delete in one transaction.
--
-- Returns one of
--   {"status": "deleted", "cancelled_requests": n}
--   {"status": "on_loan", "items": [{id, name, quantity, end_date}]}
--   {"status": "cooling_off", "until": ts, "items": [{id, name, quantity, closed_at}]}
--   {"status": "not_found"}
-- The cool-off length comes from the app (KIT_COOL_OFF_DAYS) so the number the
-- member is told and the number enforced are the same constant.
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
  -- A new borrow request's foreign-key check takes a share lock on this row,
  -- so it waits for us and then fails once the member is gone.
  perform 1 from public.members where id = p_member_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- And an approval, which updates the request row, waits on this one.
  perform 1 from public.equipment_requests where member_id = p_member_id for update;

  select coalesce(
           jsonb_agg(
             jsonb_build_object('id', r.id, 'name', coalesce(e.name, 'Club kit'), 'quantity', r.quantity, 'end_date', r.end_date)
             order by r.end_date, r.id
           ),
           '[]'::jsonb
         )
    into v_items
    from public.equipment_requests r
    left join public.equipment e on e.id = r.equipment_id
   where r.member_id = p_member_id
     and r.status = 'approved';
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
     and status = 'pending';
  get diagnostics v_cancelled = row_count;

  -- Sign-in audit rows name the person in their metadata; keep the event, drop the name.
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
revoke all on function public.stamp_loan_closed() from public, anon, authenticated;
