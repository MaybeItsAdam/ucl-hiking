import { NextResponse } from "next/server";
import {
  clearRolePreviewCookie,
  getRealMember,
  getRolePreviewState,
  setRolePreviewCookie,
  type RolePreviewConfig,
} from "@/lib/session";
import {
  canPreviewAs,
  canPreviewRoles,
  isGovernanceRole,
  isMembershipTier,
  type GovernanceRole,
  type MembershipTier,
} from "@/lib/access";

// Role preview lives under /api/admin for history, but principals use it too.
// The cookie it sets is unsigned; session.ts re-checks it against the real
// member on every read, so the checks here are for a clear error, not the only
// line of defence.

const FORBIDDEN = "Only admins and principals can use role preview.";

export async function GET() {
  const state = await getRolePreviewState();
  if (!state.canPreviewRoles) {
    return NextResponse.json(
      { canPreviewRoles: false, isRealAdmin: false, preview: null },
      { status: 403 },
    );
  }

  return NextResponse.json({
    canPreviewRoles: true,
    isRealAdmin: state.isRealAdmin,
    previewableRoles: state.previewableRoles,
    preview: state.preview,
    realMember: {
      id: state.realMember?.id,
      email: state.realMember?.email,
      fullName: state.realMember?.full_name,
      realTier: state.realMember?.membership_tier,
      realGovernanceRole: state.realMember?.governance_role,
      realIsWalkLeader: state.realMember?.is_walk_leader,
    },
  });
}

export async function POST(request: Request) {
  const realMember = await getRealMember();
  if (!realMember || !canPreviewRoles(realMember.governance_role)) {
    return NextResponse.json({ error: FORBIDDEN }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return NextResponse.json({ error: "Invalid preview config" }, { status: 400 });
  }

  const membershipTier: MembershipTier = isMembershipTier(body.membershipTier)
    ? body.membershipTier
    : "standard";

  const governanceRole: GovernanceRole | null = isGovernanceRole(body.governanceRole)
    ? body.governanceRole
    : null;

  // A preview never reaches above the member's own role: principals can't
  // preview as admin.
  if (!canPreviewAs(realMember.governance_role, governanceRole)) {
    return NextResponse.json(
      { error: "You can't preview a role above your own." },
      { status: 403 },
    );
  }

  const config: RolePreviewConfig = {
    active: true,
    membershipTier,
    governanceRole,
    isWalkLeader: body.isWalkLeader === true,
  };

  await setRolePreviewCookie(config);

  return NextResponse.json({ success: true, preview: config });
}

export async function DELETE() {
  // Leaving a preview only ever takes someone back to their own access, so any
  // signed-in member may clear the cookie (e.g. a principal who has since lost
  // the role and is left holding a stale one).
  const realMember = await getRealMember();
  if (!realMember) {
    return NextResponse.json({ error: FORBIDDEN }, { status: 403 });
  }

  await clearRolePreviewCookie();
  return NextResponse.json({ success: true });
}
