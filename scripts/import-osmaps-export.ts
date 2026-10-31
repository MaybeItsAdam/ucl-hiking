/**
 * Copy the club's whole OS Maps library into `osmaps_routes`, private routes
 * included, so the morning sync can match walks against every route the club
 * has ever planned rather than only the ones a leader has linked.
 *
 * OS Maps lists an account's routes only to that account, and the app never
 * holds the club's password (see lib/osmaps), so the routes are exported from
 * a signed-in browser into a JSON file first: an array of
 *   { id, name, modifiedAt, version, visibility, activity, distance, ascent, descent, gpx }
 * Then:
 *
 *   scripts/doppler.sh run -- npx vite-node -c vitest.config.ts scripts/import-osmaps-export.ts ~/Downloads/osmaps-routes.json
 *
 * Re-running it is safe: a route already stored with the same stamp is
 * skipped. Rides and runs are left out. Matching happens on the next sync.
 *
 * `gpx` must be the route's track export, `?exportTypes=TRK`, which carries
 * every point of a route drawn along the paths. A route plotted click to click
 * has nothing more in any export (JSON, TRK or RTE): it is stored, listed at
 * the end, and never matched to a walk (lib/routeShape). Redraw it in OS Maps
 * with "Snap to path" on, and it comes in full on the next export.
 */
import { readFileSync } from "node:fs";
import { withHeights } from "@/lib/elevation";
import { prepareRoute } from "@/lib/gpx";
import { detailsFrom, stampOf } from "@/lib/osmaps";
import { routeRow } from "@/lib/osmapsSync";
import { routeShape } from "@/lib/routeShape";
import { getSupabaseAdmin } from "@/lib/supabase";

interface Exported {
  id: string;
  name: string;
  modifiedAt: string | null;
  version: number | string | null;
  visibility: string | null;
  activity: string | null;
  distance: number | null;
  ascent: number | null;
  descent: number | null;
  gpx: string;
}

const SKIP = /RUNNING|CYCLING/;

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: import-osmaps-export.ts <export.json>");
  const routes = (JSON.parse(readFileSync(file, "utf8")) as Exported[]).filter((r) => !SKIP.test(r.activity ?? ""));
  const supabase = getSupabaseAdmin();
  const { data: known, error: readError } = await supabase.from("osmaps_routes").select("id, remote_updated_at");
  if (readError) throw new Error(readError.message);
  const stamps = new Map((known ?? []).map((r) => [r.id as string, r.remote_updated_at as string | null]));

  let stored = 0;
  let skipped = 0;
  const failures: string[] = [];
  // Stored all the same (it's what OS Maps has, and a leader may still pick it),
  // but the daily match passes these over: they draw as straight lines.
  const plotted: string[] = [];
  for (const [i, r] of routes.entries()) {
    const details = detailsFrom(r.id, {
      version: r.version,
      metadata: { name: r.name, modifiedAt: r.modifiedAt, visibility: r.visibility },
      characteristics: { distance: r.distance, elevationAscent: r.ascent, elevationDescent: r.descent },
    });
    if (stamps.get(r.id) === stampOf(details)) {
      skipped++;
      continue;
    }
    try {
      const prepared = prepareRoute(r.gpx);
      const shape = routeShape(prepared.segments);
      if (shape.plotted) plotted.push(`${r.id} ${r.name}: ${shape.km} km in ${shape.points} points`);
      const route = await withHeights(prepared);
      const { error } = await supabase.from("osmaps_routes").upsert({
        ...routeRow(details, route),
        present: true,
        private: r.visibility === "PRIVATE",
        fetched_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      stored++;
    } catch (err) {
      failures.push(`${r.id} ${r.name}: ${err instanceof Error ? err.message : err}`);
    }
    if ((i + 1) % 50 === 0) console.log(`${i + 1}/${routes.length}`);
  }
  console.log(`Stored ${stored}, unchanged ${skipped}, failed ${failures.length} of ${routes.length}.`);
  for (const f of failures) console.log(`  ${f}`);
  if (plotted.length) {
    console.log(`${plotted.length} stored are only straight lines between their clicks in OS Maps, so they won't be matched to walks:`);
    for (const p of plotted) console.log(`  ${p}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
