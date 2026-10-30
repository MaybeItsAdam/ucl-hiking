import { NextResponse } from "next/server";
import { canChangeRole, isGovernanceRole } from "@/lib/access";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { findUnlinked, REQUEST_COLUMNS, syncRosterLeader, unlinkedRosterNames, type WalkLeaderRequest } from "@/lib/walkLeaderRequests";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/admin/walk-leader-requests/:id `{ decision: "approve" | "decline" }`.
 * Approving makes them a walk leader, as the Members page toggle does, and
 * writes their email into the roster row they named so the sync keeps it.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getCurrentMember();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!UUID.test(id)) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Membership service is not configured" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { decision?: unknown } | null;
  const decision = body?.decision;
  if (decision !== "approve" && decision !== "decline") return NextResponse.json({ error: "Approve or decline?" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: req } = await supabase.from("walk_leader_requests").select(REQUEST_COLUMNS).eq("id", id).eq("status", "pending").maybeSingle();
  if (!req) return NextResponse.json({ error: "That request has already been dealt with." }, { status: 404 });
  const pending = req as WalkLeaderRequest;

  const { data: target } = await supabase
    .from("members")
    .select("id, governance_role, is_walk_leader")
    .eq("id", pending.member_id)
    .is("revoked_at", null)
    .maybeSingle();
  if (!target || (target.governance_role !== null && !isGovernanceRole(target.governance_role))) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  const allowed = canChangeRole(
    { id: actor.id, governanceRole: actor.governance_role },
    { id: target.id, governanceRole: target.governance_role },
    { field: "is_walk_leader", value: true },
  );
  if (!allowed) return NextResponse.json({ error: "Only committee can approve walk leaders, and never their own request." }, { status: 403 });

  let rosterWarning: string | null = null;
  if (decision === "approve") {
    // Claim the named roster row only if it's still unlinked: someone else's
    // row would put their name on this member, and the sync would undo it.
    let wlName: string | null = null;
    if (pending.wl_name) {
      const names = await unlinkedRosterNames().catch(() => null);
      wlName = names ? findUnlinked(names, pending.wl_name) : null;
      if (!names) rosterWarning = "Approved, but the WL roster couldn't be read. Add their email to the roster sheet.";
      else if (!wlName) rosterWarning = `"${pending.wl_name}" is already linked on the roster, so they were added as a new row. Check the roster for a duplicate.`;
    }
    const { error } = await supabase
      .from("members")
      .update({ is_walk_leader: true, walk_leader_locked: true, ...(wlName ? { wl_name: wlName } : {}) })
      .eq("id", target.id);
    if (error) return NextResponse.json({ error: "Couldn't save that change" }, { status: 500 });
    try {
      await syncRosterLeader(target.id, true);
    } catch {
      rosterWarning = "Approved here, but the WL roster sheet couldn't be updated. Add their email there too.";
    }
  }

  const { data: updated, error: decideError } = await supabase
    .from("walk_leader_requests")
    .update({ status: decision === "approve" ? "approved" : "declined", decided_by: actor.id, decided_at: new Date().toISOString() })
    .eq("id", id)
    .select(REQUEST_COLUMNS)
    .single();
  if (decideError) return NextResponse.json({ error: "Couldn't save that decision" }, { status: 500 });

  await audit(actor.id, `walk_leader_request.${decision}`, "walk_leader_request", id, { member_id: target.id, wl_name: pending.wl_name });
  if (decision === "approve") await audit(actor.id, "member.set_is_walk_leader", "member", target.id, { from: target.is_walk_leader, to: true });
  await notify([target.id], {
    kind: "leader",
    title: decision === "approve" ? "You're now a walk leader in the app" : "Your walk leader request was declined",
    body: decision === "approve" ? "The rota and leader-only walks are open to you." : "Ask the committee if you think this is a mistake.",
    url: decision === "approve" ? "/portal/events/rota" : "/account",
  });
  return NextResponse.json({ request: updated, rosterWarning });
}
