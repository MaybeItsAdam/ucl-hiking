import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

function verifySignature(payloadText: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(",");
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const v1 = parts.find((p) => p.startsWith("v1="))?.slice(3);
  if (!t || !v1) return false;

  const expected = createHmac("sha256", secret).update(`${t}.${payloadText}`).digest("hex");
  const a = Buffer.from(v1, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const webhookSecret = process.env.TOOLBOX_WEBHOOK_SECRET;

  if (webhookSecret) {
    const signature = request.headers.get("x-toolbox-signature");
    if (!verifySignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }
  }

  let body: {
    event?: string;
    data?: {
      id?: string;
      suuEventId?: string;
      title?: string;
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

  const eventType = body.event;
  const data = body.data;

  if (!eventType || !data || !data.id) {
    return NextResponse.json({ error: "Invalid payload format" }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const supabase = getSupabaseAdmin();
  const eventId = data.suuEventId || data.id;

  if (eventType === "event.deleted") {
    await supabase.from("events").delete().eq("suu_event_id", eventId);
    return NextResponse.json({ received: true, action: "deleted" });
  }

  const row = {
    suu_event_id: eventId,
    title: data.title || "Untitled Event",
    starts_at: data.startsAt || null,
    ends_at: data.endsAt || null,
    location: data.location || null,
    status: ["upcoming", "sold_out", "cancelled", "completed", "draft"].includes(String(data.status))
      ? String(data.status)
      : "upcoming",
    capacity: typeof data.capacity === "number" ? Math.max(0, data.capacity) : 0,
    tickets_sold: typeof data.ticketsSold === "number" ? Math.max(0, data.ticketsSold) : 0,
    price_pence: typeof data.pricePence === "number" ? Math.max(0, data.pricePence) : 0,
    synced_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("events").upsert(row, { onConflict: "suu_event_id" });

  if (error) {
    return NextResponse.json({ error: "Database error: " + error.message }, { status: 500 });
  }

  return NextResponse.json({ received: true, action: "upserted", id: eventId });
}
