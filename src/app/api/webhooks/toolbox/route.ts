import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

const SIGNATURE_TOLERANCE_SECONDS = 300;

function verifySignature(payloadText: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(",");
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const v1 = parts.find((p) => p.startsWith("v1="))?.slice(3);
  if (!t || !v1) return false;

  // A signature stays valid forever without this, so a captured delivery replays.
  const timestamp = Number(t);
  if (!Number.isFinite(timestamp)) return false;
  const ageSeconds = Math.abs(Date.now() / 1000 - timestamp);
  if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${t}.${payloadText}`).digest("hex");
  const a = Buffer.from(v1, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const webhookSecret = process.env.TOOLBOX_WEBHOOK_SECRET;

  if (!webhookSecret) {
    // Unsigned deliveries are a local-development convenience only. In production
    // this route writes to the events table, so an unset secret must fail closed.
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });
    }
  } else {
    const signature = request.headers.get("x-toolbox-signature");
    if (!verifySignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }
  }

  /**
   * Two spellings of the same delivery.
   *
   * Toolbox sends `{ id, type, createdAt, batchId, organiserId, data }` where
   * `data` is `{ kind, ...the event row }` — see `buildWebhookPayload` and
   * `mapDeveloperAdhocEvent` in the Toolbox repo. This route was written
   * against `{ event, data: { suuEventId, startsAt, endsAt, ... } }`, which
   * nothing sends, so every real delivery would have failed the
   * "Invalid payload format" check below.
   *
   * Both are accepted rather than swapping one for the other: the SU sync job
   * posts the second shape to `/api/sync/events`, and a webhook contract that
   * only understands one vocabulary breaks the moment either end is changed.
   */
  let body: {
    /** Toolbox's field. */
    type?: string;
    /** Original assumed field, kept so the sync job's vocabulary still works. */
    event?: string;
    data?: {
      id?: string;
      suuEventId?: string;
      title?: string;
      /** Toolbox's field names. */
      startTime?: string;
      endTime?: string;
      /** Original assumed names. */
      startsAt?: string;
      endsAt?: string;
      location?: string;
      status?: string;
      capacity?: number;
      ticketsSold?: number;
      pricePence?: number;
    };
  };

  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = body.type || body.event;
  const data = body.data;

  if (!eventType || !data || !data.id) {
    return NextResponse.json({ error: "Invalid payload format" }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const supabase = getSupabaseAdmin();
  const eventId = data.suuEventId || data.id;

  // `event.superseded` is Toolbox's duplicate resolution: this event lost to
  // another row and the survivor is delivered separately. Downstream that means
  // the same thing as a deletion — keeping it would show the reader both halves
  // of a duplicate.
  if (eventType === "event.deleted" || eventType === "event.superseded") {
    await supabase.from("events").delete().eq("suu_event_id", eventId);
    return NextResponse.json({ received: true, action: "deleted" });
  }

  /**
   * Only the fields this delivery actually carried.
   *
   * Every one of these used to be written unconditionally, so a payload that
   * omitted `capacity` reset it to 0 — and Toolbox omits capacity, ticketsSold
   * and pricePence entirely, because they are SU ticketing concepts it has no
   * source for. An upsert is a merge here, not a replace: whatever the SU sync
   * job wrote stays until something with an actual value overwrites it.
   */
  // `events.title` is `not null` with no default, so an insert must carry one.
  // Rejecting is better than the old `|| "Untitled Event"`, which quietly
  // created placeholder rows on a malformed payload and, on an update, renamed
  // a perfectly good event to the placeholder. Toolbox always sends a title —
  // its own schema requires a non-empty string — so an absent one is a bug at
  // the sender, and saying so is more use than absorbing it.
  if (!data.title) {
    return NextResponse.json(
      { error: "Invalid payload format: title is required" },
      { status: 400 },
    );
  }

  const row: Record<string, unknown> = {
    suu_event_id: eventId,
    title: data.title,
    synced_at: new Date().toISOString(),
  };

  const startsAt = data.startsAt ?? data.startTime;
  if (startsAt) row.starts_at = startsAt;
  const endsAt = data.endsAt ?? data.endTime;
  if (endsAt) row.ends_at = endsAt;
  if (data.location) row.location = data.location;
  if (["upcoming", "sold_out", "cancelled", "completed", "draft"].includes(String(data.status))) {
    row.status = String(data.status);
  }
  if (typeof data.capacity === "number") row.capacity = Math.max(0, data.capacity);
  if (typeof data.ticketsSold === "number") row.tickets_sold = Math.max(0, data.ticketsSold);
  if (typeof data.pricePence === "number") row.price_pence = Math.max(0, data.pricePence);

  const { error } = await supabase.from("events").upsert(row, { onConflict: "suu_event_id" });

  if (error) {
    return NextResponse.json({ error: "Database error: " + error.message }, { status: 500 });
  }

  return NextResponse.json({ received: true, action: "upserted", id: eventId });
}
