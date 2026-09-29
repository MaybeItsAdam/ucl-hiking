import { NextResponse } from "next/server";
import { profileOf } from "@/lib/access";
import { canEditPlan } from "@/lib/eventPlans";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/** The club's OS Maps routes, newest first, for a leader choosing one in the plan editor. */
export async function GET() {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!canEditPlan(profileOf(member))) return NextResponse.json({ error: "Only walk leaders and committee attach routes." }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ routes: [], lastSync: null });

  const supabase = getSupabaseAdmin();
  const [{ data: routes }, { data: runs }] = await Promise.all([
    supabase
      .from("osmaps_routes")
      .select("id, name, distance_m, ascent_m, planned_for, remote_updated_at")
      .eq("present", true)
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase.from("osmaps_sync_runs").select("finished_at, ok, error").order("started_at", { ascending: false }).limit(1),
  ]);
  return NextResponse.json({ routes: routes ?? [], lastSync: runs?.[0] ?? null });
}
