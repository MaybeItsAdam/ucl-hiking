import { attendedEventIds } from "@/lib/photoAlbums";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export interface PhotoAlbum {
  event_suu_id: string;
  url: string;
  updated_at: string;
}

/** Postgres or PostgREST saying the event_photo_albums table isn't there yet. */
export function isMissingAlbums(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return (error.message ?? "").includes("event_photo_albums") && /does not exist|schema cache/i.test(error.message ?? "");
}

/** Every trip's album. A missing table (before the migration) reads as none. */
export async function listAlbums(): Promise<PhotoAlbum[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseAdmin().from("event_photo_albums").select("event_suu_id, url, updated_at").limit(2000);
  if (error) {
    if (!isMissingAlbums(error)) console.error(`[photo-albums] list failed: ${error.message}`);
    return [];
  }
  return (data ?? []) as PhotoAlbum[];
}

/** One trip's album, or null. */
export async function getAlbum(eventSuuId: string): Promise<PhotoAlbum | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("event_photo_albums")
    .select("event_suu_id, url, updated_at")
    .eq("event_suu_id", eventSuuId)
    .maybeSingle();
  if (error) {
    if (!isMissingAlbums(error)) console.error(`[photo-albums] lookup failed: ${error.message}`);
    return null;
  }
  return (data as PhotoAlbum | null) ?? null;
}

/** Attach, replace or (with null) remove a trip's album. */
export async function saveAlbum(eventSuuId: string, url: string | null, memberId: string) {
  const table = getSupabaseAdmin().from("event_photo_albums");
  return url
    ? table.upsert({ event_suu_id: eventSuuId, url, updated_by: memberId }, { onConflict: "event_suu_id" })
    : table.delete().eq("event_suu_id", eventSuuId);
}

/** SU ids of the trips this person was on (see attendedEventIds). */
export async function tripsAttendedBy(person: { id: string; email: string | null }): Promise<Set<string>> {
  if (!isSupabaseConfigured()) return new Set();
  const supabase = getSupabaseAdmin();
  const columns = "event_suu_id, member_id, email, removed";
  const [byMember, byEmail, plans] = await Promise.all([
    supabase.from("event_attendees").select(columns).eq("member_id", person.id).eq("removed", false).limit(2000),
    person.email
      ? supabase.from("event_attendees").select(columns).is("member_id", null).eq("email", person.email).eq("removed", false).limit(2000)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("event_plans")
      .select("event_suu_id, leader_member_id, backmarker_member_id")
      .or(`leader_member_id.eq.${person.id},backmarker_member_id.eq.${person.id}`)
      .limit(2000),
  ]);
  return attendedEventIds(person, [...(byMember.data ?? []), ...(byEmail.data ?? [])], plans.data ?? []);
}
