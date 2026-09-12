import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Member, Walk } from "./types";

const testWalks: Record<string, Walk> = {
  "walk-pub": {
    id: "walk-pub",
    title: "Public Walk",
    location: "London",
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    distance_km: 10,
    ascent_m: 100,
    difficulty: "easy",
    capacity: 20,
    spaces_remaining: 5,
    visibility: "public",
    summary: "Public walk",
    published: true,
  },
  "walk-mem": {
    id: "walk-mem",
    title: "Members Walk",
    location: "Surrey",
    starts_at: new Date(Date.now() + 86400000 * 2).toISOString(),
    distance_km: 15,
    ascent_m: 300,
    difficulty: "moderate",
    capacity: 20,
    spaces_remaining: 5,
    visibility: "members",
    summary: "Standard member walk",
    published: true,
  },
  "walk-exp": {
    id: "walk-exp",
    title: "Explorer Walk",
    location: "Wales",
    starts_at: new Date(Date.now() + 86400000 * 3).toISOString(),
    distance_km: 25,
    ascent_m: 1000,
    difficulty: "challenging",
    capacity: 10,
    spaces_remaining: 2,
    visibility: "explorers",
    summary: "Explorer only mountain route",
    published: true,
  },
};

const registrations: { walk_id: string; member_id: string; status: string; created_at: string }[] = [];

vi.mock("./supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "walks") {
        return {
          select: () => ({
            in: (_col: string, allowedVis: string[]) => ({
              gte: () => ({
                order: () => ({
                  eq: () => Promise.resolve({
                    data: Object.values(testWalks).filter((w) => allowedVis.includes(w.visibility)),
                    error: null,
                  }),
                }),
              }),
            }),
            eq: (_col: string, val: string) => ({
              single: async () => {
                const walk = testWalks[val];
                return { data: walk || null, error: walk ? null : { message: "Not found" } };
              },
            }),
          }),
          update: (updates: Partial<Walk>) => ({
            eq: async (_col: string, val: string) => {
              if (testWalks[val]) Object.assign(testWalks[val], updates);
              return { error: null };
            },
          }),
        };
      }
      if (table === "walk_registrations") {
        return {
          select: () => ({
            eq: (_c1: string, wId: string) => ({
              in: () => Promise.resolve({ data: registrations.filter((r) => r.walk_id === wId), error: null }),
              eq: (_c2: string, mIdOrStatus: string) => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: registrations.find((r) => r.walk_id === wId && r.status === mIdOrStatus) || null,
                    }),
                  }),
                }),
                maybeSingle: async () => ({
                  data: registrations.find((r) => r.walk_id === wId && r.member_id === mIdOrStatus) || null,
                }),
                single: async () => {
                  const reg = registrations.find((r) => r.walk_id === wId && r.member_id === mIdOrStatus);
                  return { data: reg || null, error: reg ? null : { message: "Not found" } };
                },
              }),
            }),
          }),
          upsert: async (row: { walk_id: string; member_id: string; status: string }) => {
            const existing = registrations.find(
              (r) => r.walk_id === row.walk_id && r.member_id === row.member_id,
            );
            if (existing) {
              existing.status = row.status;
            } else {
              registrations.push({ ...row, created_at: new Date().toISOString() });
            }
            return { error: null };
          },
          update: (updates: { status: string }) => ({
            eq: (_c1: string, wId: string) => ({
              eq: async (_c2: string, mId: string) => {
                const reg = registrations.find((r) => r.walk_id === wId && r.member_id === mId);
                if (reg) Object.assign(reg, updates);
                return { error: null };
              },
            }),
          }),
        };
      }
      if (table === "audit_log") {
        return {
          insert: async () => ({ error: null }),
        };
      }
      return {};
    },
  }),
}));

import { cancelWalkRegistration, getWalksForMember, registerForWalk } from "./walks";

const mockTaster: Member = {
  id: "taster-1",
  email: "taster@ucl.ac.uk",
  full_name: "Taster User",
  membership_tier: "taster",
  governance_role: null,
  is_walk_leader: false,
  membership_expires_at: null,
  synced_at: new Date().toISOString(),
  sync_source: "test",
};

const mockStandard: Member = {
  id: "standard-1",
  email: "standard@ucl.ac.uk",
  full_name: "Standard User",
  membership_tier: "standard",
  governance_role: null,
  is_walk_leader: false,
  membership_expires_at: null,
  synced_at: new Date().toISOString(),
  sync_source: "test",
};

const mockExplorer: Member = {
  id: "explorer-1",
  email: "explorer@ucl.ac.uk",
  full_name: "Explorer User",
  membership_tier: "explorer",
  governance_role: null,
  is_walk_leader: false,
  membership_expires_at: null,
  synced_at: new Date().toISOString(),
  sync_source: "test",
};

describe("Walks tier visibility and access controls", () => {
  it("restricts Taster members to public walks only", async () => {
    const walks = await getWalksForMember(mockTaster);
    expect(walks.every((w) => w.visibility === "public")).toBe(true);
    expect(walks.some((w) => w.visibility === "members")).toBe(false);
    expect(walks.some((w) => w.visibility === "explorers")).toBe(false);
  });

  it("allows Standard members to see public and members walks, but not explorer walks", async () => {
    const walks = await getWalksForMember(mockStandard);
    expect(walks.some((w) => w.visibility === "public")).toBe(true);
    expect(walks.some((w) => w.visibility === "members")).toBe(true);
    expect(walks.some((w) => w.visibility === "explorers")).toBe(false);
  });

  it("allows Explorer members to see all walk tiers including explorer-only", async () => {
    const walks = await getWalksForMember(mockExplorer);
    expect(walks.some((w) => w.visibility === "public")).toBe(true);
    expect(walks.some((w) => w.visibility === "members")).toBe(true);
    expect(walks.some((w) => w.visibility === "explorers")).toBe(true);
  });
});

describe("Walk booking rules", () => {
  beforeEach(() => {
    registrations.length = 0;
  });

  it("prevents Standard members from booking Explorer-only walks", async () => {
    const result = await registerForWalk(mockStandard, "walk-exp");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Explorer");
  });

  it("prevents Taster members from booking Member walks", async () => {
    const result = await registerForWalk(mockTaster, "walk-mem");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Standard or Explorer");
  });

  it("confirms registration when spaces remain and cancels cleanly", async () => {
    const initialSpaces = testWalks["walk-pub"].spaces_remaining;
    const result = await registerForWalk(mockStandard, "walk-pub");
    expect(result.ok).toBe(true);
    expect(result.status).toBe("confirmed");
    expect(testWalks["walk-pub"].spaces_remaining).toBe(initialSpaces - 1);

    const cancelResult = await cancelWalkRegistration(mockStandard, "walk-pub");
    expect(cancelResult.ok).toBe(true);
  });
});
