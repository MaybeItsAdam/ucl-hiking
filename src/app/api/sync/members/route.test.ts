import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const db = {
  locked: [] as Record<string, unknown>[],
  upserted: [] as Record<string, unknown>[],
};

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "members") {
        return {
          select: () => ({ or: async () => ({ data: db.locked, error: null }) }),
          upsert: async (rows: Record<string, unknown>[]) => {
            db.upserted = rows;
            return { error: null };
          },
        };
      }
      return { insert: async () => ({ error: null }) };
    },
  }),
}));

function sync(members: unknown[]) {
  return POST(
    new Request("http://localhost/api/sync/members", {
      method: "POST",
      headers: { "x-member-sync-secret": "s3cret" },
      body: JSON.stringify({ source: "gcp-job", members }),
    }),
  );
}

describe("POST /api/sync/members", () => {
  beforeEach(() => {
    process.env.MEMBER_SYNC_SECRET = "s3cret";
    db.locked = [];
    db.upserted = [];
  });

  it("does not undo a committee seat or leader flag set on the Members page", async () => {
    db.locked = [
      {
        email: "sam@ucl.ac.uk",
        governance_role: "committee",
        is_walk_leader: true,
        governance_role_locked: true,
        walk_leader_locked: true,
      },
    ];
    const res = await sync([
      { email: "Sam@ucl.ac.uk", membershipTier: "explorer", governanceRole: null, isWalkLeader: false },
      { email: "alex@ucl.ac.uk", membershipTier: "standard", governanceRole: "committee", isWalkLeader: true },
    ]);
    expect(res.status).toBe(200);
    expect(db.upserted).toMatchObject([
      { email: "sam@ucl.ac.uk", governance_role: "committee", is_walk_leader: true, membership_tier: "explorer" },
      { email: "alex@ucl.ac.uk", governance_role: "committee", is_walk_leader: true },
    ]);
  });
});
