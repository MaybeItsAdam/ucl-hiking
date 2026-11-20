import type { SupabaseClient } from "@supabase/supabase-js";
import { alumniEmail, alumniLink, studentEmailFor, type StandingRow } from "@/lib/alumni";

/** Postgres or PostgREST saying the alumni table isn't there yet. */
export function isMissingAlumni(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return /\balumni\b/.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? "");
}

/**
 * Whether this member holds alumni access (a grant a principal hasn't taken
 * back). Null when it can't be told (no table yet, or the read failed), which
 * callers treat as no.
 */
export async function isGrantedAlumnus(supabase: SupabaseClient, memberId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.from("alumni").select("member_id, revoked_at").eq("member_id", memberId).maybeSingle();
    if (error) {
      if (!isMissingAlumni(error)) console.error(`[alumni] lookup failed: ${error.message}`);
      return null;
    }
    return Boolean(data && !(data as { revoked_at?: string | null }).revoked_at);
  } catch (error) {
    console.error(`[alumni] lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Sign-in with an @alumni.ucl.ac.uk address, which never matches the student
 * address on the person's members row. Finds that row by, in order:
 *   1. a grant that already names this alumni address (sign-in saved it last
 *      time, or a principal typed it in);
 *   2. the same UCL login (Toolbox user id) the row last signed in with;
 *   3. the same name before the @ on ucl.ac.uk.
 * A former member found by 2 or 3 with no grant is granted alumni access
 * there and then, and the address is saved so 1 finds them next time. One a
 * principal took access from stays out.
 *
 * Returns the members row to sign in with, or null. Any read failing returns
 * null: sign-in fails closed.
 */
export async function findAlumniSignIn<T extends { id: string } & StandingRow>(
  supabase: SupabaseClient,
  email: string,
  toolboxUserId: string,
  columns: string,
): Promise<T | null> {
  const address = alumniEmail(email);
  if (!address) return null;
  try {
    const members = () => supabase.from("members").select(columns);

    const named = await supabase.from("alumni").select("member_id, revoked_at").eq("alumni_email", address).maybeSingle();
    if (named.error) {
      if (!isMissingAlumni(named.error)) console.error(`[alumni] sign-in lookup failed: ${named.error.message}`);
      return null;
    }
    const namedGrant = named.data as { member_id: string; revoked_at: string | null } | null;
    if (namedGrant?.revoked_at) return null;

    let member: T | null = null;
    if (namedGrant) {
      const { data, error } = await members().eq("id", namedGrant.member_id).maybeSingle();
      if (error) return null;
      member = (data as unknown as T | null) ?? null;
    } else {
      const byLogin = await members().eq("toolbox_user_id", toolboxUserId).maybeSingle();
      if (byLogin.error) return null;
      member = (byLogin.data as unknown as T | null) ?? null;
      if (!member) {
        const byName = await members().eq("email", studentEmailFor(address)!).maybeSingle();
        if (byName.error) return null;
        member = (byName.data as unknown as T | null) ?? null;
      }
    }
    if (!member) return null;

    let grant: { revoked_at: string | null; alumni_email: string | null } | null = namedGrant
      ? { revoked_at: null, alumni_email: address }
      : null;
    if (!namedGrant) {
      const { data, error } = await supabase.from("alumni").select("revoked_at, alumni_email").eq("member_id", member.id).maybeSingle();
      if (error) return null;
      grant = (data as typeof grant) ?? null;
    }

    switch (alumniLink(member, grant)) {
      case "refused":
        return null;
      case "member":
        return member;
      case "auto_grant": {
        const { error } = await supabase
          .from("alumni")
          .insert({ member_id: member.id, alumni_email: address, source: "auto", granted_by: null });
        if (error) {
          console.error(`[alumni] couldn't grant on sign-in: ${error.message}`);
          return null;
        }
        return member;
      }
      case "alumnus":
        if (grant && !grant.alumni_email) {
          // A principal's grant without the address yet: remember it. Not fatal if it fails.
          await supabase.from("alumni").update({ alumni_email: address }).eq("member_id", member.id);
        }
        return member;
    }
  } catch (error) {
    console.error(`[alumni] sign-in lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
