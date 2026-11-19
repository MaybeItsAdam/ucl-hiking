import type { SupabaseClient } from "@supabase/supabase-js";

/** Postgres or PostgREST saying the alumni table isn't there yet. */
export function isMissingAlumni(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return /\balumni\b/.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? "");
}

/**
 * Whether a principal has granted this member alumni access. Null when it
 * can't be told (no table yet, or the read failed), which callers treat as no.
 */
export async function isGrantedAlumnus(supabase: SupabaseClient, memberId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.from("alumni").select("member_id").eq("member_id", memberId).maybeSingle();
    if (error) {
      if (!isMissingAlumni(error)) console.error(`[alumni] lookup failed: ${error.message}`);
      return null;
    }
    return Boolean(data);
  } catch (error) {
    console.error(`[alumni] lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
