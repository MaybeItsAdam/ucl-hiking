import { NextResponse } from "next/server";
import { profileOf } from "@/lib/access";
import { canEditPlan } from "@/lib/eventPlans";
import { fetchAll } from "@/lib/paging";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Every route still in the club's OS Maps, newest first, for a leader choosing
 * one in the plan editor. The library outgrows one PostgREST page, so it is read
 * page by page; `id` breaks ties so no route lands on two pages or none.
 */
export async function GET() {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!canEditPlan(profileOf(member))) return NextResponse.json({ error: "Only walk leaders and committee attach routes." }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ routes: [], lastSync: null });

  const supabase = getSupabaseAdmin();
  const [{ rows: routes }, { data: runs }] = await Promise.all([
    fetchAll((from, to) =>
      supabase
        .from("osmaps_routes")
        .select("id, name, distance_m, ascent_m, planned_for, remote_updated_at")
        .eq("present", true)
        .order("updated_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    supabase.from("osmaps_sync_runs").select("finished_at, ok, error").order("started_at", { ascending: false }).limit(1),
  ]);
  return NextResponse.json({ routes, lastSync: runs?.[0] ?? null });
}
