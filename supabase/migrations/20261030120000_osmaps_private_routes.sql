-- Routes copied in from the club's OS Maps account in bulk, private ones
-- included (scripts/import-osmaps-export.ts). OS Maps only answers for a
-- private route when signed in, which the daily sync never is, so it would
-- take each one as unshared and stop offering it. Private rows are left as
-- imported: the sync doesn't refresh them, and re-running the import does.

alter table public.osmaps_routes
  add column if not exists private boolean not null default false;
