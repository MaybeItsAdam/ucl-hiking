import { NextResponse } from "next/server";
import {
  clearRolePreviewCookie,
  getRealMember,
  getRolePreviewState,
  setRolePreviewCookie,
  type RolePreviewConfig,
} from "@/lib/session";
import type { GovernanceRole, MembershipTier } from "@/lib/access";

const VALID_TIERS: MembershipTier[] = ["taster", "standard", "explorer"];
const VALID_GOVERNANCE: (GovernanceRole | null)[] = [null, "committee", "principal", "admin"];

export async function GET() {
  const state = await getRolePreviewState();
  if (!state.isRealAdmin) {
    return NextResponse.json({ isRealAdmin: false, preview: null }, { status: 403 });
  }

  return NextResponse.json({
    isRealAdmin: true,
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
  if (!realMember || realMember.governance_role !== "admin") {
    return NextResponse.json(
      { error: "Only administrators can configure role preview." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();

    const membershipTier: MembershipTier = VALID_TIERS.includes(body.membershipTier)
      ? body.membershipTier
      : "standard";

    const governanceRole: GovernanceRole | null = VALID_GOVERNANCE.includes(body.governanceRole)
      ? body.governanceRole
      : null;

    const isWalkLeader = Boolean(body.isWalkLeader);
    const simulateSignedOut = Boolean(body.simulateSignedOut);

    const config: RolePreviewConfig = {
      active: true,
      membershipTier,
      governanceRole,
      isWalkLeader,
      simulateSignedOut,
    };

    await setRolePreviewCookie(config);

    return NextResponse.json({
      success: true,
      preview: config,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid preview config" },
      { status: 400 }
    );
  }
}

export async function DELETE() {
  const realMember = await getRealMember();
  if (!realMember || realMember.governance_role !== "admin") {
    return NextResponse.json(
      { error: "Only administrators can configure role preview." },
      { status: 403 }
    );
  }

  await clearRolePreviewCookie();
  return NextResponse.json({ success: true });
}
