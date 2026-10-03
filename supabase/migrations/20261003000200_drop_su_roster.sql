-- The SU scraper's roster is gone: sign-in and the Members page read the SU
-- roster from Toolbox (src/lib/toolboxMembers.ts) instead. Nothing has
-- refreshed this table since 14 Sep 2026, and no member came in through it.

drop table if exists public.su_roster;
