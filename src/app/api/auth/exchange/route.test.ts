import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

type Row = Record<string, unknown>;

const db = {
  member: null as Row | null,
  upserts: [] as Row[],
  updates: [] as Row[],
};

vi.mock("@/lib/session", () => ({ setSessionCookie: vi.fn(async () => {}) }));

vi.mock("@/lib/toolbox", () => ({
  getSocietyGovernanceRole: () => null,
  verifyToolboxToken: async () => ({ id: "toolbox-ada", email: "ada@ucl.ac.uk", name: "Ada Lovelace" }),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== "members") return { insert: async () => ({ error: null }) };
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.member, error: null }) }) }),
        upsert: (row: Row) => {
          db.upserts.push(row);
          const linked = { id: "m1", governance_role: null, is_walk_leader: false, ...db.member, ...row };
          return { select: () => ({ single: async () => ({ data: linked, error: null }) }) };
        },
        update: (row: Row) => {
          db.updates.push(row);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  }),
}));

const rosterMember = (fullName: string, membershipType = "Explorer") => ({
  id: `tb-${fullName}`,
  toolboxUserId: null,
  email: null,
  fullName,
  memberType: "Student",
  membershipType,
  dateRange: "01/09/2026 - 31/08/2027",
  identityStatus: "unlinked",
});

function toolboxRoster(members: unknown[] | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      members
        ? new Response(JSON.stringify({ snapshot: { id: "s", syncedAt: new Date().toISOString(), memberCount: members.length, complete: true }, members }))
        : new Response("down", { status: 503 }),
    ),
  );
}

const signIn = () => POST(new Request("http://localhost/api/auth/exchange", { method: "POST", body: JSON.stringify({ token: "t" }) }));

describe("POST /api/auth/exchange — name match on Toolbox's roster", () => {
  beforeEach(() => {
    process.env.TOOLBOX_API_TOKEN = "token";
    process.env.TOOLBOX_ORGANISER_ID = "org";
    process.env.SESSION_SECRET = "x".repeat(32);
    delete process.env.TOOLBOX_MEMBERS_AUTHORITATIVE;
    db.member = null;
    db.upserts = [];
    db.updates = [];
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lets a newcomer in on an unambiguous name match, at the roster's tier", async () => {
    toolboxRoster([rosterMember("Ada Lovelace"), rosterMember("Alan Turing", "Taster")]);
    const res = await signIn();
    expect(res.status).toBe(200);
    expect(db.upserts).toMatchObject([
      { email: "ada@ucl.ac.uk", membership_tier: "explorer", sync_source: "toolbox-name-match", source_reference: "toolbox-member:tb-Ada Lovelace", revoked_at: null },
    ]);
  });

  it("keeps a newcomer out when Toolbox can't be read", async () => {
    toolboxRoster(null);
    expect((await signIn()).status).toBe(403);
    expect(db.upserts).toEqual([]);
  });

  it("revokes a name-matched member who has left the roster", async () => {
    db.member = { id: "m1", email: "ada@ucl.ac.uk", full_name: "Ada Lovelace", membership_tier: "standard", governance_role: null, is_walk_leader: false, membership_expires_at: null, revoked_at: null, sync_source: "toolbox-name-match" };
    toolboxRoster([rosterMember("Alan Turing")]);
    expect((await signIn()).status).toBe(403);
    expect(db.updates[0]).toHaveProperty("revoked_at");
  });

  it("lets a name-matched member keep their access while Toolbox is down", async () => {
    db.member = { id: "m1", email: "ada@ucl.ac.uk", full_name: "Ada Lovelace", membership_tier: "standard", governance_role: null, is_walk_leader: false, membership_expires_at: null, revoked_at: null, sync_source: "toolbox-name-match" };
    toolboxRoster(null);
    expect((await signIn()).status).toBe(200);
  });

  it("stops matching names once Toolbox membership is authoritative", async () => {
    process.env.TOOLBOX_MEMBERS_AUTHORITATIVE = "true";
    toolboxRoster([rosterMember("Ada Lovelace")]);
    expect((await signIn()).status).toBe(403);
    expect(db.upserts).toEqual([]);
  });
});
