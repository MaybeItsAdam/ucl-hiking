import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { POST } from "./route";

const db = {
  configured: true,
  upsertError: null as string | null,
  upserted: null as unknown,
};

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => db.configured,
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "events") {
        return {
          upsert: async (row: unknown) => {
            db.upserted = row;
            return { error: db.upsertError ? { message: db.upsertError } : null };
          },
          delete: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      return {};
    },
  }),
}));

describe("POST /api/webhooks/toolbox", () => {
  beforeEach(() => {
    db.configured = true;
    db.upsertError = null;
    db.upserted = null;
    delete process.env.TOOLBOX_WEBHOOK_SECRET;
  });

  it("accepts an un-signed webhook outside production when no secret is configured", async () => {
    const payload = {
      event: "event.created",
      data: {
        id: "evt_123",
        title: "Box Hill Hike",
        startsAt: "2026-09-10T09:00:00Z",
        location: "Surrey",
      },
    };

    const req = new Request("http://localhost:3001/api/webhooks/toolbox", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(body.action).toBe("upserted");
  });

  it("verifies HMAC SHA-256 signature when TOOLBOX_WEBHOOK_SECRET is set", async () => {
    process.env.TOOLBOX_WEBHOOK_SECRET = "whsec_supersecret123";
    const payload = JSON.stringify({
      event: "event.updated",
      data: {
        id: "evt_123",
        title: "Updated Hike",
      },
    });

    const timestamp = String(Math.floor(Date.now() / 1000));
    const hmac = createHmac("sha256", "whsec_supersecret123")
      .update(`${timestamp}.${payload}`)
      .digest("hex");

    const req = new Request("http://localhost:3001/api/webhooks/toolbox", {
      method: "POST",
      headers: {
        "x-toolbox-signature": `t=${timestamp},v1=${hmac}`,
      },
      body: payload,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });

  it("rejects an invalid signature with 401", async () => {
    process.env.TOOLBOX_WEBHOOK_SECRET = "whsec_supersecret123";
    const req = new Request("http://localhost:3001/api/webhooks/toolbox", {
      method: "POST",
      headers: {
        "x-toolbox-signature": `t=${Math.floor(Date.now() / 1000)},v1=invalid_signature`,
      },
      body: JSON.stringify({ event: "event.created", data: { id: "evt_1" } }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects a correctly signed but stale delivery with 401", async () => {
    process.env.TOOLBOX_WEBHOOK_SECRET = "whsec_supersecret123";
    const payload = JSON.stringify({ event: "event.created", data: { id: "evt_1" } });
    const timestamp = String(Math.floor(Date.now() / 1000) - 3600);
    const hmac = createHmac("sha256", "whsec_supersecret123")
      .update(`${timestamp}.${payload}`)
      .digest("hex");

    const req = new Request("http://localhost:3001/api/webhooks/toolbox", {
      method: "POST",
      headers: { "x-toolbox-signature": `t=${timestamp},v1=${hmac}` },
      body: payload,
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(db.upserted).toBeNull();
  });

  it("refuses un-signed deliveries in production instead of writing them", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const req = new Request("http://localhost:3001/api/webhooks/toolbox", {
        method: "POST",
        body: JSON.stringify({ event: "event.created", data: { id: "evt_1" } }),
      });

      const res = await POST(req);
      expect(res.status).toBe(503);
      expect(db.upserted).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
