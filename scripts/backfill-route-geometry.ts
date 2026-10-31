/**
 * Find the stored routes that are only their planner's clicks, which draw as
 * straight lines (lib/routeShape), and put right what can be (lib/routeBackfill).
 *
 * A dry run by default: it reads `osmaps_routes` and `event_routes` and says
 * what it would do. With --apply it:
 *   1. fetches each shared plotted library route from OS Maps again, in case
 *      it has been redrawn along the paths, and passes it on to its walks;
 *   2. copies a walk's route again from its library route where the walk has
 *      straight lines and the library now has the path;
 *   3. reruns the daily match, which now passes plotted routes over, so a
 *      walk matched to one can get a full route instead.
 * Private routes aren't fetched (OS Maps only shows them signed in): redraw
 * them in OS Maps and import a new export.
 *
 *   scripts/doppler.sh run -p hiking-webapp -c prd -- npx tsx scripts/backfill-route-geometry.ts
 *   scripts/doppler.sh run -p hiking-webapp -c prd -- npx tsx scripts/backfill-route-geometry.ts --apply
 */
import { eventRouteFrom, importOsmapsRoute, matchAndAttach, type OsmapsRouteRow } from "@/lib/osmapsSync";
import { describePlan, planBackfill, type LibraryRouteRow, type WalkRouteRow } from "@/lib/routeBackfill";
import { isPlotted } from "@/lib/routeShape";
import { getSupabaseAdmin } from "@/lib/supabase";

const PAGE = 200;

async function readAll<T>(table: string, columns: string, key: string): Promise<T[]> {
  const supabase = getSupabaseAdmin();
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).order(key).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return rows;
  }
}

async function load() {
  const [library, walks] = await Promise.all([
    readAll<LibraryRouteRow>("osmaps_routes", "id, name, private, present, segments", "id"),
    readAll<WalkRouteRow>("event_routes", "event_suu_id, name, source, osmaps_route_id, segments", "event_suu_id"),
  ]);
  return planBackfill(library, walks);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const plan = await load();
  console.log(describePlan(plan));
  if (!apply) {
    console.log("\nDry run: nothing changed. Run again with --apply to make these changes.");
    return;
  }

  const supabase = getSupabaseAdmin();
  console.log("\nFetching shared plotted routes from OS Maps again…");
  let redrawn = 0;
  for (const r of plan.refetch) {
    try {
      const row = await importOsmapsRoute(r.id, null);
      if (!row || isPlotted(row.segments)) continue;
      redrawn++;
      // Now along the paths: on to every walk using it, as the morning sync does for an edit.
      const { data: users } = await supabase.from("event_routes").select("event_suu_id, source, updated_by, match_reasons").eq("osmaps_route_id", r.id);
      for (const u of users ?? []) {
        const next = eventRouteFrom(u.event_suu_id, row, u.source, u.updated_by, u.match_reasons);
        const { error } = await supabase.from("event_routes").update(next).eq("event_suu_id", u.event_suu_id);
        if (error) console.log(`  walk ${u.event_suu_id}: ${error.message}`);
      }
    } catch (err) {
      console.log(`  ${r.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`  ${redrawn} of ${plan.refetch.length} now follow the paths; OS Maps still has the rest as clicks only.`);

  // Planned again, so walks on a route just fetched aren't copied twice.
  const { recopy } = await load();
  console.log(`Copying ${recopy.length} walks' routes again from the library…`);
  for (const { eventSuuId, osmapsRouteId } of recopy) {
    const { data: row } = await supabase.from("osmaps_routes").select("*").eq("id", osmapsRouteId).maybeSingle<OsmapsRouteRow>();
    const { data: have } = await supabase.from("event_routes").select("source, updated_by, match_reasons").eq("event_suu_id", eventSuuId).maybeSingle();
    if (!row || !have) continue;
    const { error } = await supabase
      .from("event_routes")
      .update(eventRouteFrom(eventSuuId, row, have.source, have.updated_by, have.match_reasons))
      .eq("event_suu_id", eventSuuId);
    if (error) console.log(`  walk ${eventSuuId}: ${error.message}`);
  }

  console.log("Matching walks again, passing plotted routes over…");
  console.log(`  ${await matchAndAttach()} walks given a route.`);

  console.log("\nAfter:");
  console.log(describePlan(await load()));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
