import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Record who did what. Best effort: an audit write that fails never fails the
 * action it describes, but it is logged so a gap can be found.
 */
export async function audit(
  actorMemberId: string | null,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await getSupabaseAdmin().from("audit_log").insert({
    actor_member_id: actorMemberId,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata,
  });
  if (error) console.error(`[audit] ${action} on ${targetType}/${targetId} was not recorded: ${error.message}`);
}
