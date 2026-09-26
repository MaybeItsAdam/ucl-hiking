import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { eventsBefore, notifyEventChanges } from "@/lib/eventChanges";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { toolboxEventRow, type ToolboxEventData } from "@/lib/toolboxEvents";

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
    data?: ToolboxEventData;
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
  if (eventType === "event.deleted" || eventType === "event.superseded" || data.supersededById) {
    await supabase.from("events").delete().eq("suu_event_id", eventId);
    return NextResponse.json({ received: true, action: "deleted" });
  }

  // Field-by-field rules (merge, not replace; which kinds are skipped) live in
  // toolboxEventRow, shared with the daily reconcile in /api/sync/toolbox-events.
  const mapped = toolboxEventRow(data, new Date().toISOString());
  if (!mapped.ok) {
    if (mapped.skip) {
      // A 2xx, so Toolbox does not keep retrying something we will never store.
      return NextResponse.json({ received: true, action: "ignored", reason: mapped.reason });
    }
    return NextResponse.json({ error: `Invalid payload format: ${mapped.reason}` }, { status: 400 });
  }
  const row = mapped.row;

  const before = await eventsBefore([eventId]);
  const { error } = await supabase.from("events").upsert(row, { onConflict: "suu_event_id" });

  if (error) {
    return NextResponse.json({ error: "Database error: " + error.message }, { status: 500 });
  }

  await notifyEventChanges(before, [row]);
  return NextResponse.json({ received: true, action: "upserted", id: eventId });
}
