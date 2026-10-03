import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const db = {
  runs: [] as Record<string, unknown>[],
  memberWrites: 0,
  owned: [] as { id: string; toolbox_user_id: string | null; sync_source: string }[],
  revoked: [] as string[],
};

vi.mock("@/lib/session", () => ({ getCurrentMember: async () => null }));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "member_sync_runs") {
        return {
          insert: async (row: Record<string, unknown>) => {
            db.runs.push(row);
            return { error: null };
          },
        };
      }
      return {
        select: () => ({
          is: async () => ({ data: [{ toolbox_user_id: "u1", email: "sam@ucl.ac.uk", membership_tier: "standard" }], error: null }),
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          in: (_column: string, sources: string[]) => ({
            is: async () => ({ data: db.owned.filter((row) => sources.includes(row.sync_source)), error: null }),
          }),
        }),
        insert: async () => {
          db.memberWrites += 1;
          return { error: null };
        },
        update: () => {
          db.memberWrites += 1;
          return {
            eq: async () => ({ error: null }),
            in: async (_column: string, ids: string[]) => {
              db.revoked.push(...ids);
              return { error: null };
            },
          };
        },
      };
    },
  }),
}));

const member = (toolboxUserId: string, email: string, membershipType: string) => ({
  id: toolboxUserId,
  toolboxUserId,
  email,
  fullName: email,
  memberType: null,
  membershipType,
  dateRange: null,
  identityStatus: "confirmed",
});

function toolboxReturns(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

const sync = () => GET(new Request("http://localhost/api/sync/toolbox-members", { headers: { authorization: "Bearer cron" } }));

describe("GET /api/sync/toolbox-members", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron";
    process.env.TOOLBOX_API_TOKEN = "token";
    process.env.TOOLBOX_ORGANISER_ID = "org";
    delete process.env.TOOLBOX_MEMBERS_AUTHORITATIVE;
    db.runs = [];
    db.memberWrites = 0;
    db.owned = [];
    db.revoked = [];
  });
  afterEach(() => vi.unstubAllGlobals());

  it("records a shadow run's comparison without touching members", async () => {
    toolboxReturns({
      snapshot: { id: "s", syncedAt: new Date().toISOString(), memberCount: 2, complete: true },
      members: [member("u1", "sam@ucl.ac.uk", "Explorer"), member("u2", "alex@ucl.ac.uk", "Taster")],
    });
    const res = await sync();
    expect(res.status).toBe(200);
    expect(db.memberWrites).toBe(0);
    expect(db.runs).toMatchObject([
      {
        source: "toolbox-members",
        mode: "shadow",
        received_count: 2,
        upserted_count: 0,
        comparison: { toolboxEligible: 2, hikingActive: 1, onlyToolbox: 1, onlyHiking: 0, tierMismatches: 1 },
      },
    ]);
    expect(db.runs[0].error).toBeUndefined();
  });

  it("records why a run stopped when Toolbox fails", async () => {
    toolboxReturns({ error: "nope" }, 503);
    const res = await sync();
    expect(res.status).toBe(502);
    expect(db.runs).toMatchObject([{ mode: "shadow", received_count: 0, comparison: null, error: "Toolbox members API returned 503" }]);
  });

  it("records a stale snapshot as a failed run", async () => {
    toolboxReturns({
      snapshot: { id: "s", syncedAt: "2026-01-01T00:00:00Z", memberCount: 1, complete: true },
      members: [member("u1", "sam@ucl.ac.uk", "Standard")],
    });
    const res = await sync();
    expect(res.status).toBe(409);
    expect(db.runs).toMatchObject([{ received_count: 1, error: "Toolbox member snapshot is older than 72 hours; nobody was changed" }]);
  });

  it("once authoritative, revokes name-matched sign-ins Toolbox hasn't confirmed", async () => {
    process.env.TOOLBOX_MEMBERS_AUTHORITATIVE = "true";
    db.owned = [
      { id: "kept", toolbox_user_id: "u1", sync_source: "toolbox-name-match" },
      { id: "gone", toolbox_user_id: "u9", sync_source: "toolbox-name-match" },
      { id: "committee", toolbox_user_id: "u8", sync_source: "toolbox-auth" },
    ];
    toolboxReturns({
      snapshot: { id: "s", syncedAt: new Date().toISOString(), memberCount: 1, complete: true },
      members: [member("u1", "sam@ucl.ac.uk", "Standard")],
    });
    const res = await sync();
    expect(res.status).toBe(200);
    expect(db.revoked).toEqual(["gone"]);
    expect(db.runs).toMatchObject([{ mode: "authoritative", upserted_count: 1, revoked_count: 1 }]);
  });
});
