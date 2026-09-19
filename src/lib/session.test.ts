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
});
