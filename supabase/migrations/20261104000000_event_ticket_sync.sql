-- When an event's ticket counts (tickets_sold, capacity) were last read from
-- the SU. The scraper that used to fill those columns is retired; they now
-- come from Toolbox's SU ticket sales, read by a principal's Connector. Null
-- means nothing has synced since, so the numbers aren't shown as current.
alter table public.events
  add column if not exists tickets_synced_at timestamptz;
