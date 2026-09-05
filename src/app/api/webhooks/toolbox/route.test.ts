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

  it("accepts the payload shape Toolbox actually sends", async () => {
    // { type, data: { kind, ...event } } with startTime/endTime — see
    // buildWebhookPayload and mapDeveloperAdhocEvent in the Toolbox repo.
    // This route originally read `body.event` and `data.startsAt`, so every
    // real delivery would have been rejected as malformed.
    const req = new Request("http://localhost:3001/api/webhooks/toolbox", {
      method: "POST",
      body: JSON.stringify({
        id: "whd_abc123",
        type: "event.created",
        createdAt: "2026-09-05T12:00:00Z",
        batchId: "batch_1",
        organiserId: "org_hiking",
        data: {
          kind: "adhoc",
          id: "evt_toolbox_1",
          title: "Box Hill Hike",
          startTime: "2026-09-10T09:00:00Z",
          endTime: "2026-09-10T17:00:00Z",
          location: "Surrey",
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const row = db.upserted as Record<string, unknown>;
    expect(row.suu_event_id).toBe("evt_toolbox_1");
    expect(row.title).toBe("Box Hill Hike");
    expect(row.starts_at).toBe("2026-09-10T09:00:00Z");
    expect(row.ends_at).toBe("2026-09-10T17:00:00Z");
  });

  it("omits ticketing fields Toolbox does not send, rather than zeroing them", async () => {
    // capacity/ticketsSold/pricePence come from the SU sync job. Writing them
    // unconditionally meant a Toolbox delivery reset all three to 0.
    const req = new Request("http://localhost:3001/api/webhooks/toolbox", {
      method: "POST",
      body: JSON.stringify({
        type: "event.updated",
        data: { kind: "adhoc", id: "evt_1", title: "Hike", startTime: "2026-09-10T09:00:00Z" },
      }),
    });

    await POST(req);
    const row = db.upserted as Record<string, unknown>;
    expect(row).not.toHaveProperty("capacity");
    expect(row).not.toHaveProperty("tickets_sold");
    expect(row).not.toHaveProperty("price_pence");
    expect(row).not.toHaveProperty("status");
  });

  it("still accepts the sync job's startsAt/endsAt vocabulary", async () => {
    const req = new Request("http://localhost:3001/api/webhooks/toolbox", {
      method: "POST",
      body: JSON.stringify({
        event: "event.created",
        data: { id: "evt_2", title: "Snowdon", startsAt: "2026-10-01T08:00:00Z", capacity: 20 },
      }),
    });

    await POST(req);
    const row = db.upserted as Record<string, unknown>;
    expect(row.starts_at).toBe("2026-10-01T08:00:00Z");
    expect(row.capacity).toBe(20);
  });

  it("treats event.superseded as a removal", async () => {
    // Toolbox emits it when a duplicate loses a resolution; the survivor is
    // delivered separately, so keeping this one shows the reader both halves.
    const req = new Request("http://localhost:3001/api/webhooks/toolbox", {
      method: "POST",
      body: JSON.stringify({ type: "event.superseded", data: { id: "evt_3", title: "Dupe" } }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect((await res.json()).action).toBe("deleted");
    expect(db.upserted).toBeNull();
  });

  it("rejects an upsert with no title instead of inventing one", async () => {
    // events.title is NOT NULL with no default.
    const req = new Request("http://localhost:3001/api/webhooks/toolbox", {
      method: "POST",
      body: JSON.stringify({ type: "event.created", data: { id: "evt_4" } }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
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
