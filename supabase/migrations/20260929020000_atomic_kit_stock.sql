-- Kit stock moves in the database, with the status change that causes it.
--
-- The request route used to read `equipment.available_quantity`, then write
-- back `read - quantity`. Two principals approving different requests for the
-- same item at once both read the same number, and one approval's decrement was
-- lost: the club lent out more tents than it had.
--
-- Now a trigger on equipment_requests moves stock relative to the current row
-- (`available_quantity - n`), which Postgres serialises on the equipment row
-- lock. An approval that would take stock below zero fails with
-- 'insufficient_stock' and rolls back its status change with it.

create or replace function public.move_kit_stock() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_available integer;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
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
  elsif old.status = 'approved' and new.status is distinct from 'approved' then
    update public.equipment
       set available_quantity = least(total_quantity, available_quantity + old.quantity)
     where id = old.equipment_id;
  end if;
  return new;
end;
$$;

drop trigger if exists equipment_requests_move_stock on public.equipment_requests;
create trigger equipment_requests_move_stock
  after update of status on public.equipment_requests
  for each row execute function public.move_kit_stock();

revoke all on function public.move_kit_stock() from public, anon, authenticated;
