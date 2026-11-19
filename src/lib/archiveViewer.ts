import { cache } from "react";
import { can, profileOf } from "@/lib/access";
import { archiveStanding, type StandingRow } from "@/lib/alumni";
import { isGrantedAlumnus } from "@/lib/alumniStore";
import { getCurrentMember, getSession } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/** Who is looking at the Navigator or the photo archive. */
export interface ArchiveViewer {
  id: string;
  email: string;
  full_name: string | null;
  standing: "member" | "alumnus";
  /** The committee see every trip's album; everyone else, the trips they went on. */
  seesAll: boolean;
}

/**
 * The viewer for the routes alumni may use (lib/alumni ALUMNI_ROUTES) and only
 * those. A current member comes through getCurrentMember() as everywhere
 * else, role preview included. Failing that, a signed-in member whose
 * membership has lapsed is let in as an alumnus if a principal granted it.
 *
 * Memoised per request: the app shell and the page both ask.
 */
export const getArchiveViewer = cache(async (): Promise<ArchiveViewer | null> => {
  const member = await getCurrentMember();
  if (member) {
    return {
      id: member.id,
      email: member.email,
      full_name: member.full_name,
      standing: "member",
      seesAll: can(profileOf(member), "manage_walks"),
    };
  }

  const session = await getSession();
  if (!session || !isSupabaseConfigured()) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("members")
    .select("id, email, full_name, revoked_at, membership_expires_at")
    .eq("id", session.memberId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; email: string; full_name: string | null } & StandingRow;
  if (archiveStanding(row, await isGrantedAlumnus(supabase, row.id)) !== "alumnus") return null;
  return { id: row.id, email: row.email, full_name: row.full_name, standing: "alumnus", seesAll: false };
});
