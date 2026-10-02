import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { isClaimKind, signClaimToken } from "@/lib/reimbursementToken";
import { getCurrentMember } from "@/lib/session";

/**
 * A ten-minute pass for one expense claim. The browser sends the claim, bank
 * details and all, straight to the treasurer's Apps Script with this token;
 * nothing about the claim itself ever reaches this server.
 */
export async function GET(request: Request) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const kind = new URL(request.url).searchParams.get("kind");
  if (!isClaimKind(kind)) return NextResponse.json({ error: "Say whether it's a walk leader or committee claim." }, { status: 400 });
  // Preview never widens this: getCurrentMember() already returns the previewed (lower) role.
  const profile = profileOf(member);
  const allowed = kind === "wl" ? can(profile, "lead_walks") : can(profile, "manage_club");
  if (!allowed) {
    return NextResponse.json(
      { error: kind === "wl" ? "Walk leader claims are for walk leaders." : "Committee claims are for the committee." },
      { status: 403 },
    );
  }

  const secret = process.env.REIMBURSE_SIGNING_SECRET;
  const endpoint = process.env.REIMBURSE_SCRIPT_URL;
  if (!secret || !endpoint) {
    return NextResponse.json({ error: "Expense claims aren't set up yet. Use the Google Form for now." }, { status: 503 });
  }

  const token = signClaimToken({ sub: member.id, email: member.email, name: member.full_name ?? "", kind }, secret);
  return NextResponse.json({ token, endpoint }, { headers: { "Cache-Control": "no-store" } });
}
