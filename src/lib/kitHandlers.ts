import type { SupabaseClient } from "@supabase/supabase-js";
import { can, profileOf } from "@/lib/access";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import type { Member } from "@/lib/types";

/** Postgres or PostgREST saying the kit_handlers table isn't there yet. */
export function isMissingKitHandlers(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return (error.message ?? "").includes("kit_handlers") && /does not exist|schema cache/i.test(error.message ?? "");
}

/**
 * Whether a principal has granted this member scanning by hand. Null when it
 * can't be told (no table yet, or the read failed), which callers treat as no.
 */
export async function isGrantedKitHandler(supabase: SupabaseClient, memberId: string): Promise<boolean | null> {
  const { data, error } = await supabase.from("kit_handlers").select("member_id").eq("member_id", memberId).maybeSingle();
  if (error) {
    if (!isMissingKitHandlers(error)) console.error(`[kit-handlers] lookup failed: ${error.message}`);
    return null;
  }
  return Boolean(data);
}

/**
 * Who may scan tagged kit: committee, principals and admins by role, and
 * anyone a principal has granted it to. A role preview shows the role alone,
 * so a grant never leaks into "see the app as a standard member".
 */
export async function canHandleKit(member: Member): Promise<boolean> {
  if (can(profileOf(member), "handle_kit")) return true;
  if (member.is_preview || !isSupabaseConfigured()) return false;
  return (await isGrantedKitHandler(getSupabaseAdmin(), member.id)) === true;
}
