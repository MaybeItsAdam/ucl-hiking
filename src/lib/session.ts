import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { GovernanceRole, MembershipTier } from "@/lib/access";
import type { Member } from "@/lib/types";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

const COOKIE_NAME = "ucl_hiking_session";
const MAX_AGE = 60 * 60 * 24 * 7;

export interface HikingSession {
  toolboxUserId: string;
  memberId: string;
  email: string;
  name?: string;
  membershipTierAtSignIn: MembershipTier;
  governanceRoleAtSignIn: GovernanceRole | null;
  wasWalkLeaderAtSignIn: boolean;
}

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
  return new TextEncoder().encode(value);
}

export async function createSessionToken(session: HikingSession): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

export async function readSessionToken(token: string): Promise<HikingSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.memberId || !payload.email || !payload.toolboxUserId) return null;
    return payload as unknown as HikingSession;
  } catch {
    return null;
  }
}

export async function setSessionCookie(session: HikingSession): Promise<void> {
  const token = await createSessionToken(session);
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getSession(): Promise<HikingSession | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  return token ? readSessionToken(token) : null;
}

/**
 * Resolve access from Supabase on every privileged request. The access fields
 * captured at sign-in are display history only and never authorize a request.
 */
export async function getCurrentMember(): Promise<Member | null> {
  const session = await getSession();
  if (!session || !isSupabaseConfigured()) return null;

  const { data, error } = await getSupabaseAdmin()
    .from("members")
    .select("id,email,full_name,membership_tier,governance_role,is_walk_leader,membership_expires_at,synced_at,sync_source")
    .eq("id", session.memberId)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) return null;
  if (data.membership_expires_at && new Date(data.membership_expires_at) < new Date()) {
    return null;
  }
  return data as Member;
}

export function sessionCookieName(): string {
  return COOKIE_NAME;
}
