import { NextResponse } from "next/server";
import { cronOrCommittee } from "@/lib/cronAuth";
import { syncOsmapsRoutes } from "@/lib/osmapsSync";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Each morning: refresh the club's OS Maps routes and put them on their walks
 * (see lib/osmapsSync). Vercel Cron calls it with `Authorization: Bearer
 * $CRON_SECRET`; committee can also run it by hand while signed in.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!(await cronOrCommittee(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const supabase = getSupabaseAdmin();
  const { data: run } = await supabase.from("osmaps_sync_runs").insert({}).select("id").single();
  const finish = (fields: Record<string, unknown>) =>
    run ? supabase.from("osmaps_sync_runs").update({ finished_at: new Date().toISOString(), ...fields }).eq("id", run.id) : null;

  try {
    const result = await syncOsmapsRoutes();
    await finish({
      ok: result.failures.length === 0,
      routes_seen: result.routesSeen,
      routes_downloaded: result.routesDownloaded,
      walks_matched: result.walksMatched + result.walksLinked,
      error: result.failures.length ? result.failures.map((f) => `${f.id}: ${f.error}`).join("\n").slice(0, 2000) : null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finish({ ok: false, error: message.slice(0, 2000) });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
