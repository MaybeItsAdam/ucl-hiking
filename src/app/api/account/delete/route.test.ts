import { beforeEach, describe, expect, it, vi } from "vitest";
import { KIT_COOL_OFF_DAYS } from "@/lib/kitLoans";
import { POST } from "./route";

const state = {
  session: { memberId: "m-1", email: "sam@ucl.ac.uk", name: "Sam" } as { memberId: string; email: string; name?: string } | null,
  rpc: { data: null as unknown, error: null as { code?: string; message: string } | null },
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  principals: [{ id: "p-1" }, { id: "p-2" }],
  audits: [] as unknown[][],
  notified: [] as { ids: string[]; message: Record<string, unknown> }[],
  cleared: 0,
};

vi.mock("@/lib/session", () => ({
  getSession: async () => state.session,
  clearSessionCookie: async () => {
    state.cleared += 1;
  },
  clearRolePreviewCookie: async () => {},
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args });
      return state.rpc;
    },
    from: (table: string) => {
      if (table !== "members") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({ in: () => ({ is: () => ({ neq: async () => ({ data: state.principals, error: null }) }) }) }),
      };
    },
  }),
}));

vi.mock("@/lib/audit", () => ({
  audit: async (...args: unknown[]) => {
    state.audits.push(args);
  },
}));

vi.mock("@/lib/notify", () => ({
  notify: async (ids: string[], message: Record<string, unknown>) => {
    state.notified.push({ ids, message });
    return { inbox: ids.length, pushed: 0 };
  },
}));

function del(body: unknown = { confirm: "delete" }) {
  return POST(new Request("http://localhost/api/account/delete", { method: "POST", body: JSON.stringify(body) }));
}

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    state.session = { memberId: "m-1", email: "sam@ucl.ac.uk", name: "Sam" };
    state.rpc = { data: { status: "deleted", cancelled_requests: 0 }, error: null };
    state.rpcCalls = [];
    state.audits = [];
    state.notified = [];
    state.cleared = 0;
  });

  it("deletes the session's own member through the atomic database function", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(state.rpcCalls).toEqual([
      { fn: "delete_member_account", args: { p_member_id: "m-1", p_cool_off_days: KIT_COOL_OFF_DAYS } },
    ]);
    expect(state.cleared).toBe(1);
  });

  it("needs a session and an explicit confirmation", async () => {
    expect((await del({})).status).toBe(400);
    state.session = null;
    expect((await del()).status).toBe(401);
    expect(state.rpcCalls).toEqual([]);
  });

  it("refuses with the items on loan, audits it and tells the principals", async () => {
    state.rpc = {
      data: { status: "on_loan", items: [{ id: "r-1", name: "Tent", quantity: 2, end_date: "2026-09-05" }] },
      error: null,
    };
    const res = await del();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.block).toEqual({ reason: "on_loan", items: [{ id: "r-1", name: "Tent", quantity: 2, endDate: "2026-09-05" }] });
    expect(body.error).toContain("2 × Tent");
    expect(state.cleared).toBe(0);
    expect(state.audits).toEqual([["m-1", "account.self_delete_blocked", "member", "m-1", { reason: "on_loan", requests: ["r-1"] }]]);
    expect(state.notified).toHaveLength(1);
    expect(state.notified[0].ids).toEqual(["p-1", "p-2"]);
    expect(state.notified[0].message).toMatchObject({ kind: "kit", title: "Sam tried to delete their account with kit out" });
  });

  it("refuses during the cool-off, audited but without bothering the principals", async () => {
    state.rpc = {
      data: { status: "cooling_off", until: "2026-10-06T10:00:00+00:00", items: [{ id: "r-2", name: "Stove", quantity: 1 }] },
      error: null,
    };
    const res = await del();
    expect(res.status).toBe(409);
    expect((await res.json()).block.reason).toBe("cooling_off");
    expect(state.audits).toHaveLength(1);
    expect(state.notified).toEqual([]);
    expect(state.cleared).toBe(0);
  });

  it("treats the members trigger firing as kit on loan", async () => {
    state.rpc = { data: null, error: { code: "23001", message: "member m-1 still has 1 club kit loan(s) out" } };
    const res = await del();
    expect(res.status).toBe(409);
    expect(state.cleared).toBe(0);
  });

  it("fails closed on an unexpected result", async () => {
    state.rpc = { data: { status: "surprise" }, error: null };
    expect((await del()).status).toBe(500);
    expect(state.cleared).toBe(0);
  });
});
