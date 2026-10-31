-- How many stored routes are only their planner's clicks, and so draw as
-- straight lines. Read-only: paste into the Supabase SQL editor.
-- The same test as src/lib/routeShape.ts: at least 1 km long, and half its
-- length or more in straight legs over 300 m, or under 3 points a km.
with pts as (
  select 'osmaps_routes' as tbl, r.id::text as id,
         case when r.private then 'private' else 'shared' end as kind,
         s.ord as seg, p.ord as i, (p.pt->>0)::float8 as lat, (p.pt->>1)::float8 as lng
  from public.osmaps_routes r
  cross join lateral jsonb_array_elements(r.segments) with ordinality s(seg, ord)
  cross join lateral jsonb_array_elements(s.seg) with ordinality p(pt, ord)
  union all
  select 'event_routes', e.event_suu_id, coalesce(e.source, 'upload'),
         s.ord, p.ord, (p.pt->>0)::float8, (p.pt->>1)::float8
  from public.event_routes e
  cross join lateral jsonb_array_elements(e.segments) with ordinality s(seg, ord)
  cross join lateral jsonb_array_elements(s.seg) with ordinality p(pt, ord)
),
prev as (
  select tbl, id, kind, lat, lng, lag(lat) over w as lat0, lag(lng) over w as lng0
  from pts
  window w as (partition by tbl, id, seg order by i)
),
legs as (
  -- Metres from the point before; null for each segment's first point.
  select tbl, id, kind,
         case when lat0 is not null then 2 * 6371008.8 * asin(least(1, sqrt(
           power(sin(radians(lat - lat0) / 2), 2)
           + cos(radians(lat)) * cos(radians(lat0)) * power(sin(radians(lng - lng0) / 2), 2)
         ))) end as m
  from prev
),
shape as (
  select tbl, id, kind, count(*) as points,
         coalesce(sum(m), 0) / 1000 as km,
         coalesce(sum(m) filter (where m > 300), 0) / nullif(sum(m), 0) as straight_share
  from legs
  group by tbl, id, kind
)
select tbl, kind,
       count(*) as routes,
       count(*) filter (where km >= 1 and (straight_share >= 0.5 or points / nullif(km, 0) < 3)) as straight_lines,
       round(100.0 * count(*) filter (where km >= 1 and (straight_share >= 0.5 or points / nullif(km, 0) < 3)) / count(*), 1) as pct,
       round(percentile_cont(0.5) within group (order by points / nullif(km, 0))::numeric, 1) as median_points_per_km
from shape
group by tbl, kind
order by tbl, kind;
