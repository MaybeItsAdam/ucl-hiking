import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { canHandleKit } from "@/lib/kitHandlers";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Member } from "@/lib/types";

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

/**
 * Scanning tagged kit: committee, principals and admins, and anyone a
 * principal has granted it to (`kit_handlers`). They hand kit over against an
 * already-approved loan, take it back, tag it and audit it. Approving loans,
 * resolving reports and deleting items stay behind `requireLender`.
 */
export async function requireKitHandler(): Promise<
  { ok: true; memberId: string; supabase: SupabaseClient } | { ok: false; response: NextResponse }
> {
  const member = await getCurrentMember();
  if (!member) return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  if (!(await canHandleKit(member))) {
    return {
      ok: false,
      response: json({ error: "Forbidden: only the committee and members a principal has allowed can scan kit" }, 403),
    };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, response: json({ error: "Database not configured" }, 503) };
  }
  return { ok: true, memberId: member.id, supabase: getSupabaseAdmin() };
}

/**
 * Any signed-in member: anyone may scan a tag to see what it is and who has
 * it, and confirm they've been handed it. `handlesKit` says whether they also
 * get the lender's view and actions.
 */
export async function requireMember(): Promise<
  | { ok: true; member: Member; handlesKit: boolean; supabase: SupabaseClient }
  | { ok: false; response: NextResponse }
> {
  const member = await getCurrentMember();
  if (!member) return { ok: false, response: json({ error: "Sign in to look up club kit." }, 401) };
  if (!isSupabaseConfigured()) {
    return { ok: false, response: json({ error: "Database not configured" }, 503) };
  }
  return { ok: true, member, handlesKit: await canHandleKit(member), supabase: getSupabaseAdmin() };
}

export async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: json({ error: "Invalid JSON" }, 400) };
  }
}
