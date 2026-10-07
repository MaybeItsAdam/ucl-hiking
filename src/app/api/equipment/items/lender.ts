import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Never cache a scan or the kit list: they change with every handover. */
export const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Tagged kit is for kit lenders only: the same permission that approves loans
 * (`review_equipment_requests`), so whoever can approve a request can hand its
 * kit over, take it back, tag it and audit it.
 */
export async function requireLender(): Promise<
  { ok: true; memberId: string; supabase: SupabaseClient } | { ok: false; response: NextResponse }
> {
  const member = await getCurrentMember();
  if (!member) return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  if (!can(profileOf(member), "review_equipment_requests")) {
    return { ok: false, response: json({ error: "Forbidden: only kit lenders can scan, tag and audit kit" }, 403) };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, response: json({ error: "Database not configured" }, 503) };
  }
  return { ok: true, memberId: member.id, supabase: getSupabaseAdmin() };
}

export async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: json({ error: "Invalid JSON" }, 400) };
  }
}
