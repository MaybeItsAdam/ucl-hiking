import { KIT_COOL_OFF_DAYS, OUTSTANDING_LOAN_STATUSES, deletionBlock, type DeletionBlock, type LoanRow } from "@/lib/kitLoans";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Whether this member could delete their account right now, for the account
 * page to explain before they try. Server only. Advisory: the delete itself is
 * checked again, atomically, by `delete_member_account()`.
 *
 * Pass the session's member id, never a previewed one.
 */
export async function getDeletionBlock(memberId: string, now: Date = new Date()): Promise<DeletionBlock | null> {
  if (!isSupabaseConfigured()) return null;
  const since = new Date(now.getTime() - KIT_COOL_OFF_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("equipment_requests")
    .select("id, status, quantity, end_date, loan_closed_at, equipment:equipment_id (name)")
    .eq("member_id", memberId)
    .or(`status.in.(${OUTSTANDING_LOAN_STATUSES.join(",")}),loan_closed_at.gt.${since}`);
  // The delete re-checks; a failed look-ahead just means no warning up front.
  if (error) return null;
  return deletionBlock((data ?? []) as unknown as LoanRow[], now);
}
