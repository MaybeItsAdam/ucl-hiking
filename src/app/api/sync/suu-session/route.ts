import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/**
 * GET /api/sync/suu-session — the SU login a principal saved in the portal, for
 * the Cloud Run sync jobs. Makes the portal the one place to update it when it
 * expires; the jobs fall back to their `suu-session-id` secret when nothing is
 * saved here. Same shared secret as the other sync routes, never a browser.
 */

function secretMatches(provided: string | null): boolean {
  const expected = process.env.MEMBER_SYNC_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!secretMatches(request.headers.get("x-member-sync-secret"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { data } = await getSupabaseAdmin()
    .from("suu_session_settings")
    .select("session_id,auth_state,status,updated_at")
    .eq("id", "default")
    .maybeSingle();

  const usable = data && data.status !== "expired" && (data.session_id || data.auth_state);
  return NextResponse.json(
    usable
      ? { sessionId: data.session_id, authState: data.auth_state, status: data.status, updatedAt: data.updated_at }
      : { sessionId: null, authState: null, status: data?.status ?? "unconfigured", updatedAt: data?.updated_at ?? null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
