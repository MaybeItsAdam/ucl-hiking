import { linkKey, type ClubLink } from "@/lib/clubLinks";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/** Where a short link goes, or null when there's no such link. */
export async function findClubLinkDestination(path: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseAdmin().from("club_links").select("destination").eq("path_key", linkKey(path)).maybeSingle();
  if (error) console.error(`[club-links] lookup of ${path} failed: ${error.message}`);
  return data?.destination ?? null;
}

export async function listClubLinks(): Promise<ClubLink[]> {
  if (!isSupabaseConfigured()) return [];
  const { data } = await getSupabaseAdmin().from("club_links").select("id, path, destination, note, updated_at").order("path_key");
  return data ?? [];
}
