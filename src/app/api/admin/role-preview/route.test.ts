import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, DELETE } from "./route";

import type { Member } from "@/lib/types";
import type { RolePreviewConfig, RolePreviewState } from "@/lib/session";

type MockState = Omit<RolePreviewState, "realMember"> & { realMember: Partial<Member> | null };
const NO_PREVIEW: MockState = {
  canPreviewRoles: false,
  isRealAdmin: false,
  previewableRoles: [],
  preview: null,
  realMember: null,
};

let mockRealMember: Partial<Member> | null = null;
let mockPreviewState: MockState = NO_PREVIEW;
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

function post(body: unknown): Request {
  return new Request("http://localhost:3000/api/admin/role-preview", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("Role Preview API (/api/admin/role-preview)", () => {
  beforeEach(() => {
    mockRealMember = null;
    mockPreviewState = NO_PREVIEW;
    savedPreview = null;
    cleared = false;
  });

  it("rejects GET if user is not a real admin", async () => {
    const res = await GET();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.isRealAdmin).toBe(false);
    expect(body.canPreviewRoles).toBe(false);
  });

  it("returns preview state on GET if user is a real admin", async () => {
    mockPreviewState = {
      canPreviewRoles: true,
      isRealAdmin: true,
      previewableRoles: [null, "committee", "principal", "admin"],
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

  it("returns preview state on GET for a principal, without admin in the options", async () => {
    mockPreviewState = {
      canPreviewRoles: true,
      isRealAdmin: false,
      previewableRoles: [null, "committee", "principal"],
      preview: null,
      realMember: { id: "p-1", full_name: "Pat Principal", governance_role: "principal" },
    };

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canPreviewRoles).toBe(true);
    expect(body.isRealAdmin).toBe(false);
    expect(body.previewableRoles).not.toContain("admin");
    expect(body.realMember.realGovernanceRole).toBe("principal");
  });

  it("lets a principal preview any role below admin", async () => {
    mockRealMember = { id: "p-1", email: "p@ucl.ac.uk", governance_role: "principal" };

    for (const governanceRole of [null, "committee", "principal"]) {
      const res = await POST(post({ membershipTier: "explorer", governanceRole, isWalkLeader: false }));
      expect(res.status).toBe(200);
      expect(savedPreview?.governanceRole).toBe(governanceRole);
    }
  });

  it("refuses to let a principal preview as admin", async () => {
    mockRealMember = { id: "p-1", email: "p@ucl.ac.uk", governance_role: "principal" };

    const res = await POST(post({ membershipTier: "explorer", governanceRole: "admin", isWalkLeader: true }));
    expect(res.status).toBe(403);
    expect(savedPreview).toBeNull();
  });

  it("rejects POST from committee members", async () => {
    mockRealMember = { id: "c-1", email: "c@ucl.ac.uk", governance_role: "committee" };

    const res = await POST(post({ membershipTier: "taster", governanceRole: null, isWalkLeader: false }));
    expect(res.status).toBe(403);
    expect(savedPreview).toBeNull();
  });

  it("lets an admin preview as admin", async () => {
    mockRealMember = { id: "admin-1", email: "admin@ucl.ac.uk", governance_role: "admin" };

    const res = await POST(post({ membershipTier: "standard", governanceRole: "admin", isWalkLeader: false }));
    expect(res.status).toBe(200);
    expect(savedPreview?.governanceRole).toBe("admin");
  });

  it("lets a principal leave a preview via DELETE", async () => {
    mockRealMember = { id: "p-1", email: "p@ucl.ac.uk", governance_role: "principal" };

    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(cleared).toBe(true);
  });

  it("rejects DELETE when signed out", async () => {
    const res = await DELETE();
    expect(res.status).toBe(403);
    expect(cleared).toBe(false);
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
    });
  });

  it("ignores a request to preview as signed out", async () => {
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
    expect(savedPreview).not.toHaveProperty("simulateSignedOut");
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
