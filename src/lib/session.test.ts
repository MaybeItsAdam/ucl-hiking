import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSessionToken,
  getCurrentMember,
  getRolePreviewState,
  type HikingSession,
  type RolePreviewConfig,
} from "./session";

process.env.SESSION_SECRET = "12345678901234567890123456789012";

let mockCookieStore: Record<string, string> = {};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (mockCookieStore[name] ? { value: mockCookieStore[name] } : undefined),
    set: (name: string, value: string) => {
      mockCookieStore[name] = value;
    },
  })),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  getSupabaseAdmin: () => ({}),
}));

describe("session role preview resolution", () => {
  beforeEach(() => {
    mockCookieStore = {};
  });

  it("returns real member unmodified when no preview cookie exists", async () => {
    const session: HikingSession = {
      toolboxUserId: "admin-1",
      memberId: "member-admin",
      email: "admin@ucl.ac.uk",
      name: "Admin User",
      membershipTierAtSignIn: "explorer",
      governanceRoleAtSignIn: "admin",
      wasWalkLeaderAtSignIn: true,
    };
    mockCookieStore["ucl_hiking_session"] = await createSessionToken(session);

    const member = await getCurrentMember();
    expect(member).not.toBeNull();
    expect(member?.membership_tier).toBe("explorer");
    expect(member?.governance_role).toBe("admin");
    expect(member?.is_walk_leader).toBe(true);
    expect(member?.is_preview).toBeUndefined();
  });

  it("does not allow a non-admin to activate role preview", async () => {
    const session: HikingSession = {
      toolboxUserId: "user-1",
      memberId: "member-regular",
      email: "student@ucl.ac.uk",
      name: "Regular Student",
      membershipTierAtSignIn: "standard",
      governanceRoleAtSignIn: null,
      wasWalkLeaderAtSignIn: false,
    };
    mockCookieStore["ucl_hiking_session"] = await createSessionToken(session);

    const preview: RolePreviewConfig = {
      active: true,
      membershipTier: "explorer",
      governanceRole: "admin",
      isWalkLeader: true,
    };
    mockCookieStore["ucl_hiking_role_preview"] = JSON.stringify(preview);

    const member = await getCurrentMember();
    expect(member).not.toBeNull();
    // Permissions must NOT have been elevated
    expect(member?.membership_tier).toBe("standard");
    expect(member?.governance_role).toBeNull();
    expect(member?.is_walk_leader).toBe(false);
    expect(member?.is_preview).toBeUndefined();
  });

  it("applies role preview override when user is a genuine admin", async () => {
    const session: HikingSession = {
      toolboxUserId: "admin-1",
      memberId: "member-admin",
      email: "admin@ucl.ac.uk",
      name: "Admin User",
      membershipTierAtSignIn: "explorer",
      governanceRoleAtSignIn: "admin",
      wasWalkLeaderAtSignIn: true,
    };
    mockCookieStore["ucl_hiking_session"] = await createSessionToken(session);

    const preview: RolePreviewConfig = {
      active: true,
      membershipTier: "taster",
      governanceRole: null,
      isWalkLeader: false,
    };
    mockCookieStore["ucl_hiking_role_preview"] = JSON.stringify(preview);

    const member = await getCurrentMember();
    expect(member).not.toBeNull();
    expect(member?.membership_tier).toBe("taster");
    expect(member?.governance_role).toBeNull();
    expect(member?.is_walk_leader).toBe(false);
    expect(member?.is_preview).toBe(true);
    expect(member?.real_governance_role).toBe("admin");
  });

  it("ignores a stored signed-out preview so the admin keeps their own access", async () => {
    const session: HikingSession = {
      toolboxUserId: "admin-1",
      memberId: "member-admin",
      email: "admin@ucl.ac.uk",
      name: "Admin User",
      membershipTierAtSignIn: "explorer",
      governanceRoleAtSignIn: "admin",
      wasWalkLeaderAtSignIn: true,
    };
    mockCookieStore["ucl_hiking_session"] = await createSessionToken(session);
    mockCookieStore["ucl_hiking_role_preview"] = JSON.stringify({
      active: true,
      membershipTier: "standard",
      governanceRole: null,
      isWalkLeader: false,
      simulateSignedOut: true,
    });

    const member = await getCurrentMember();
    expect(member?.governance_role).toBe("admin");
    expect(member?.is_preview).toBeUndefined();

    const state = await getRolePreviewState();
    expect(state.isRealAdmin).toBe(true);
    expect(state.preview).toBeNull();
  });
  describe("principals", () => {
    async function signInAsPrincipal() {
      const session: HikingSession = {
        toolboxUserId: "principal-1",
        memberId: "member-principal",
        email: "president@ucl.ac.uk",
        name: "Pat Principal",
        membershipTierAtSignIn: "standard",
        governanceRoleAtSignIn: "principal",
        wasWalkLeaderAtSignIn: true,
      };
      mockCookieStore["ucl_hiking_session"] = await createSessionToken(session);
    }

    it("can preview a role below their own, keeping their real identity", async () => {
      await signInAsPrincipal();
      mockCookieStore["ucl_hiking_role_preview"] = JSON.stringify({
        active: true,
        membershipTier: "taster",
        governanceRole: "committee",
        isWalkLeader: false,
      } satisfies RolePreviewConfig);

      const member = await getCurrentMember();
      expect(member?.id).toBe("member-principal");
      expect(member?.email).toBe("president@ucl.ac.uk");
      expect(member?.governance_role).toBe("committee");
      expect(member?.membership_tier).toBe("taster");
      expect(member?.is_preview).toBe(true);
      expect(member?.real_governance_role).toBe("principal");

      const state = await getRolePreviewState();
      expect(state.canPreviewRoles).toBe(true);
      expect(state.isRealAdmin).toBe(false);
      expect(state.previewableRoles).toEqual([null, "committee", "principal"]);
      expect(state.preview?.governanceRole).toBe("committee");
    });

    it("ignores a hand-written cookie that previews as admin", async () => {
      await signInAsPrincipal();
      mockCookieStore["ucl_hiking_role_preview"] = JSON.stringify({
        active: true,
        membershipTier: "explorer",
        governanceRole: "admin",
        isWalkLeader: true,
      } satisfies RolePreviewConfig);

      const member = await getCurrentMember();
      expect(member?.governance_role).toBe("principal");
      expect(member?.membership_tier).toBe("standard");
      expect(member?.is_preview).toBeUndefined();

      const state = await getRolePreviewState();
      expect(state.preview).toBeNull();
    });
  });

  it("ignores a committee member's preview cookie", async () => {
    const session: HikingSession = {
      toolboxUserId: "c-1",
      memberId: "member-committee",
      email: "c@ucl.ac.uk",
      membershipTierAtSignIn: "standard",
      governanceRoleAtSignIn: "committee",
      wasWalkLeaderAtSignIn: false,
    };
    mockCookieStore["ucl_hiking_session"] = await createSessionToken(session);
    mockCookieStore["ucl_hiking_role_preview"] = JSON.stringify({
      active: true,
      membershipTier: "explorer",
      governanceRole: "principal",
      isWalkLeader: true,
    });

    const member = await getCurrentMember();
    expect(member?.governance_role).toBe("committee");
    expect(member?.is_preview).toBeUndefined();
    expect((await getRolePreviewState()).canPreviewRoles).toBe(false);
  });

  it("ignores a malformed preview cookie", async () => {
    const session: HikingSession = {
      toolboxUserId: "admin-1",
      memberId: "member-admin",
      email: "admin@ucl.ac.uk",
      membershipTierAtSignIn: "explorer",
      governanceRoleAtSignIn: "admin",
      wasWalkLeaderAtSignIn: true,
    };
    mockCookieStore["ucl_hiking_session"] = await createSessionToken(session);
    mockCookieStore["ucl_hiking_role_preview"] = JSON.stringify({
      active: true,
      membershipTier: "platinum",
      governanceRole: "superuser",
      isWalkLeader: "yes",
    });

    const member = await getCurrentMember();
    expect(member?.governance_role).toBe("admin");
    expect(member?.is_preview).toBeUndefined();
  });
});
