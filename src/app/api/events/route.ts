import { NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

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

  return NextResponse.json({ events: data });
}
