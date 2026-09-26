import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  prefs: [] as { member_id: string; kind: string; enabled: boolean }[],
  tokens: [] as { token: string; member_id: string }[],
  inserted: [] as Record<string, unknown>[],
  deletedTokens: [] as string[],
};

vi.mock("./supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({
    from(table: string) {
      if (table === "notification_prefs") {
        return { select: () => ({ in: () => ({ eq: async (_: string, kind: string) => ({ data: db.prefs.filter((p) => p.kind === kind) }) }) }) };
      }
      if (table === "notifications") {
        return {
          insert: async (rows: Record<string, unknown>[]) => {
            db.inserted.push(...rows);
            return { error: null };
          },
        };
      }
      if (table === "push_tokens") {
        return {
          select: () => ({ in: async (_: string, ids: string[]) => ({ data: db.tokens.filter((t) => ids.includes(t.member_id)) }) }),
          delete: () => ({
            in: async (_: string, tokens: string[]) => {
              db.deletedTokens.push(...tokens);
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

const { fcmMessage, isDeadToken, notify, recipientsAfterPrefs } = await import("./notify");

describe("recipientsAfterPrefs", () => {
  it("drops members who turned an optional kind off, and duplicates", () => {
    expect(recipientsAfterPrefs(["a", "b", "a"], "reminder", [{ member_id: "b", kind: "reminder", enabled: false }])).toEqual(["a"]);
  });
  it("never lets anyone opt out of walk changes", () => {
    expect(recipientsAfterPrefs(["a"], "event_changed", [{ member_id: "a", kind: "event_changed", enabled: false }])).toEqual(["a"]);
  });
});

describe("FCM helpers", () => {
  it("builds a v1 message that opens the right page", () => {
    const msg = fcmMessage("tok", { kind: "kit", title: "Approved", url: "/portal/equipment" });
    expect(msg.message.token).toBe("tok");
    expect(msg.message.notification).toEqual({ title: "Approved" });
    expect(msg.message.data).toEqual({ kind: "kit", url: "/portal/equipment" });
  });
  it("recognises dead tokens", () => {
    expect(isDeadToken(404, "")).toBe(true);
    expect(isDeadToken(400, '{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}')).toBe(true);
    expect(isDeadToken(500, "UNREGISTERED")).toBe(false);
  });
});

describe("notify", () => {
  beforeEach(() => {
    db.prefs = [];
    db.tokens = [];
    db.inserted = [];
    db.deletedTokens = [];
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fills the inbox and skips push when Firebase isn't configured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await notify(["a", "b"], { kind: "broadcast", title: "Hello" });
    expect(result).toEqual({ inbox: 2, pushed: 0 });
    expect(db.inserted.map((r) => r.member_id)).toEqual(["a", "b"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("pushes to every token and forgets the dead ones", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
      project_id: "ucl-hiking",
      client_email: "push@ucl-hiking.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    });
    db.tokens = [
      { token: "live", member_id: "a" },
      { token: "gone", member_id: "b" },
    ];
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }));
      const body = JSON.parse(String(init.body));
      return body.message.token === "live" ? new Response("{}") : new Response('{"error":"UNREGISTERED"}', { status: 404 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await notify(["a", "b"], { kind: "event_changed", title: "Cancelled: Box Hill" });
    expect(result).toEqual({ inbox: 2, pushed: 1 });
    expect(db.deletedTokens).toEqual(["gone"]);
    const send = fetchSpy.mock.calls.find(([url]) => String(url).includes("fcm.googleapis.com"))!;
    expect(String(send[0])).toBe("https://fcm.googleapis.com/v1/projects/ucl-hiking/messages:send");
    expect((send[1].headers as Record<string, string>).Authorization).toBe("Bearer at");
  });
});
