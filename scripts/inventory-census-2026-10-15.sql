-- One-off: load the October 2026 kit census into public.equipment.
-- Not a migration (deploy-migrate only reads supabase/migrations). Run by hand:
--   doppler-hiking run -p hiking-webapp -c prd -- bash -c 'psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/inventory-census-2026-10-15.sql'
--
-- The three rows already in the catalogue are part of the census, so they are
-- updated in place (keeping their ids) rather than duplicated. The census wins
-- over what was hand-entered before it. Safe to re-run: new rows are only
-- inserted when no row of that name exists.

begin;

-- Existing: Spectre 300 x4. One needs repairing, recorded in the description.
update public.equipment
set name = 'Vango Spectre 300 (3-person)',
    description = 'Old. One of the four needs repairing.',
    updated_at = now()
where id = 'd5fa4ff1-a722-4800-97e8-1b5ac091be3b';

-- Existing: "Nevis Tunnel 300" x4 was really Nevis 300 x2 + Nevis 100 x2.
update public.equipment
set name = 'Vango Nevis 300 (3-person)',
    total_quantity = 2,
    available_quantity = 2,
    condition = 'good',
    updated_at = now()
where id = 'd9fa30bb-432f-4579-af69-ca145004fda0';

-- Existing: "Hiking poles" x6 (green, MT500) was Forclaz 500 green x4 + anti-shock blue x2.
update public.equipment
set name = 'Forclaz 500 hiking pole (green)',
    category = 'Navigation & Safety',
    description = null,
    total_quantity = 4,
    available_quantity = 4,
    condition = 'good',
    updated_at = now()
where id = '392a1f43-829e-4ca0-874e-d555c0bfd8c6';

insert into public.equipment (name, category, description, total_quantity, available_quantity, condition)
select v.name, v.category, v.description, v.qty, v.qty, v.condition
from (values
  ('Radio',                                   'Navigation & Safety', 'Kept in storage.',                                         13, 'good'),
  ('Survival first aid kit (extra large)',    'Navigation & Safety', 'Family size.',                                              2, 'good'),
  ('Lifesystems mountain first aid kit',      'Navigation & Safety', 'Medium size.',                                              2, 'good'),
  ('Value sports first aid kit',              'Navigation & Safety', 'Very lightweight.',                                         1, 'good'),
  ('Forclaz 500 anti-shock hiking pole (blue)','Navigation & Safety', null,                                                       2, 'good'),
  ('Nitecore head torch',                     'Navigation & Safety', null,                                                        4, 'good'),
  ('JETech waterproof phone case',            'Navigation & Safety', null,                                                        7, 'good'),
  ('OS maps',                                 'Navigation & Safety', 'A range, some old and some new. Say which map you want and we will check.', 1, 'good'),
  ('Lomo emergency shelter (4-person)',       'Tents & Shelter',     null,                                                        2, 'good'),
  ('Rab emergency shelter (8–10 person)',     'Tents & Shelter',     null,                                                        1, 'good'),
  ('Vango Nevis 100 (1-person)',              'Tents & Shelter',     null,                                                        2, 'good'),
  ('Hongze inflatable roll mat',              'Sleeping Gear',       'New. Two green, one blue.',                                 3, 'excellent'),
  ('Roll mat (blue)',                         'Sleeping Gear',       null,                                                        1, 'good'),
  ('Gelert camper mat (blue)',                'Sleeping Gear',       null,                                                        1, 'good'),
  ('Skysper day rucksack (35L)',              'Rucksacks & Bags',    'Three black, two light blue.',                              5, 'good'),
  ('Eurohike hiking rucksack (65L)',          'Rucksacks & Bags',    'One black, one olive.',                                     2, 'good'),
  ('Forclaz camping stove',                   'Cooking & Stoves',    'Standalone.',                                               1, 'good'),
  ('Trangia, small (green)',                  'Cooking & Stoves',    'With stove, two saucepans and one lid.',                    1, 'good'),
  ('Trangia with windshield',                 'Cooking & Stoves',    'Two small saucepans, frying pan and kettle. One set has a handle, the other does not.', 2, 'good'),
  ('Trangia, large',                          'Cooking & Stoves',    'Two saucepans, one frying pan, two lids, with handles.',    1, 'good'),
  ('Kettle (2L, blue)',                       'Cooking & Stoves',    'Brand new.',                                                1, 'excellent')
) as v(name, category, description, qty, condition)
where not exists (select 1 from public.equipment e where e.name = v.name);

select category, name, total_quantity, available_quantity, condition
from public.equipment
order by category, name;

commit;
