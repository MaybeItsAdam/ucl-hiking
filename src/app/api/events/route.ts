import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import type { SUEvent } from "@/lib/types";
import { viewerOf, visibleEvents } from "@/lib/walkVisibility";

export async function GET() {
  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      const { getDevEvents } = await import("@/lib/dev-store");
      return NextResponse.json({ events: getDevEvents() });
    }
    return NextResponse.json({ events: [] });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .gte("starts_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order("starts_at", { ascending: true });

  if (error || !data) {
    return NextResponse.json({ events: [] });
  }

  // Same rules as the Events tab: unpublished walks stay with the committee.
  return NextResponse.json({ events: await visibleEvents(data as SUEvent[], viewerOf(await getCurrentMember())) });
}
