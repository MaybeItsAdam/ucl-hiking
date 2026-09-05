import type { Walk } from "@/lib/types";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

const demoWalks: Walk[] = [
  {
    id: "demo-1", title: "Box Hill & the Stepping Stones", location: "Surrey Hills",
    starts_at: "2026-09-12T08:15:00+01:00", distance_km: 14.2, ascent_m: 510,
    difficulty: "moderate", capacity: 24, spaces_remaining: 6, visibility: "public",
    summary: "Woodland climbs and views over the North Downs.",
  },
  {
    id: "demo-2", title: "Seven Sisters Traverse", location: "Seaford to Eastbourne",
    starts_at: "2026-09-21T07:30:00+01:00", distance_km: 22.5, ascent_m: 870,
    difficulty: "challenging", capacity: 30, spaces_remaining: 11, visibility: "public",
    summary: "The classic chalk-cliff day with the sea beside us.",
  },
  {
    id: "demo-3", title: "Epping Forest Wander", location: "Chingford",
    starts_at: "2026-09-27T09:45:00+01:00", distance_km: 9.8, ascent_m: 160,
    difficulty: "easy", capacity: 20, spaces_remaining: 4, visibility: "public",
    summary: "A relaxed first walk through ancient woodland.",
  },
];

export async function getPublicWalks(): Promise<Walk[]> {
  if (!isSupabaseConfigured()) return demoWalks;
  const { data, error } = await getSupabaseAdmin()
    .from("walks")
    .select("id,title,location,starts_at,distance_km,ascent_m,difficulty,capacity,spaces_remaining,visibility,summary")
    .eq("published", true)
    .eq("visibility", "public")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(3);
  return error || !data?.length ? demoWalks : (data as Walk[]);
}
