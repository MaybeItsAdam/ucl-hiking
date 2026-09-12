import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, DELETE } from "./route";

import type { Member } from "@/lib/types";
import type { RolePreviewConfig } from "@/lib/session";

let mockRealMember: Partial<Member> | null = null;
let mockPreviewState: {
  isRealAdmin: boolean;
  preview: RolePreviewConfig | null;
  realMember: Partial<Member> | null;
} = { isRealAdmin: false, preview: null, realMember: null };
let savedPreview: RolePreviewConfig | null = null;
let cleared = false;

vi.mock("@/lib/session", () => ({
  getRealMember: vi.fn(async () => mockRealMember),
  getRolePreviewState: vi.fn(async () => mockPreviewState),
  setRolePreviewCookie: vi.fn(async (config: RolePreviewConfig) => {
    savedPreview = config;
  }),
  clearRolePreviewCookie: vi.fn(async () => {
    cleared = true;
    savedPreview = null;
  }),
}));

describe("Role Preview API (/api/admin/role-preview)", () => {
  beforeEach(() => {
    mockRealMember = null;
    mockPreviewState = { isRealAdmin: false, preview: null, realMember: null };
    savedPreview = null;
    cleared = false;
  });

  it("rejects GET if user is not a real admin", async () => {
    const res = await GET();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.isRealAdmin).toBe(false);
  });

  it("returns preview state on GET if user is a real admin", async () => {
    mockPreviewState = {
      isRealAdmin: true,
      preview: { active: true, membershipTier: "taster", governanceRole: null, isWalkLeader: false },
      realMember: {
        id: "admin-1",
        email: "admin@ucl.ac.uk",
        full_name: "Admin User",
        membership_tier: "explorer",
        governance_role: "admin",
        is_walk_leader: true,
      },
    };

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isRealAdmin).toBe(true);
    expect(body.preview.membershipTier).toBe("taster");
    expect(body.realMember.fullName).toBe("Admin User");
  });

  it("rejects POST if user is not an admin", async () => {
    mockRealMember = {
      id: "user-1",
      email: "user@ucl.ac.uk",
      governance_role: null,
    };

    const req = new Request("http://localhost:3000/api/admin/role-preview", {
      method: "POST",
      body: JSON.stringify({
        membershipTier: "taster",
        governanceRole: null,
        isWalkLeader: false,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("allows real admin to set preview configuration", async () => {
    mockRealMember = {
      id: "admin-1",
      email: "admin@ucl.ac.uk",
      governance_role: "admin",
    };

    const req = new Request("http://localhost:3000/api/admin/role-preview", {
      method: "POST",
      body: JSON.stringify({
        membershipTier: "taster",
        governanceRole: "committee",
        isWalkLeader: true,
        simulateSignedOut: false,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(savedPreview).toEqual({
      active: true,
      membershipTier: "taster",
      governanceRole: "committee",
      isWalkLeader: true,
      simulateSignedOut: false,
    });
  });

  it("allows real admin to set signed-out preview", async () => {
    mockRealMember = {
      id: "admin-1",
      email: "admin@ucl.ac.uk",
      governance_role: "admin",
    };

    const req = new Request("http://localhost:3000/api/admin/role-preview", {
      method: "POST",
      body: JSON.stringify({
        membershipTier: "standard",
        governanceRole: null,
        isWalkLeader: false,
        simulateSignedOut: true,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(savedPreview?.simulateSignedOut).toBe(true);
  });

  it("allows real admin to reset preview via DELETE", async () => {
    mockRealMember = {
      id: "admin-1",
      email: "admin@ucl.ac.uk",
      governance_role: "admin",
    };

    const res = await DELETE();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(cleared).toBe(true);
  });
});
