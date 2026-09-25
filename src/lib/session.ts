import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import type { GovernanceRole, MembershipTier } from "@/lib/access";
import type { Member } from "@/lib/types";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

const COOKIE_NAME = "ucl_hiking_session";
// Long enough that the phone app doesn't sign people out every week. The cookie
// only proves identity: access is reloaded from the members table on every
// request, so revoking or expiring a member still takes effect immediately.
const MAX_AGE = 60 * 60 * 24 * 90;

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
    .setExpirationTime(`${MAX_AGE}s`)
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

export interface RolePreviewConfig {
  active: boolean;
  membershipTier: MembershipTier;
  governanceRole: GovernanceRole | null;
  isWalkLeader: boolean;
}

const ROLE_PREVIEW_COOKIE = "ucl_hiking_role_preview";

export async function getRolePreview(): Promise<RolePreviewConfig | null> {
  try {
    const raw = (await cookies()).get(ROLE_PREVIEW_COOKIE)?.value;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    // The old "public visitor" preview hid the admin's own session, and with it
    // the menu to leave the preview. Treat any such cookie as no preview at all.
    if (parsed.simulateSignedOut) return null;
    return parsed as RolePreviewConfig;
  } catch {
    return null;
  }
}

export async function setRolePreviewCookie(config: RolePreviewConfig): Promise<void> {
  (await cookies()).set(ROLE_PREVIEW_COOKIE, JSON.stringify(config), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24, // 24 hours
  });
}

export async function clearRolePreviewCookie(): Promise<void> {
  (await cookies()).set(ROLE_PREVIEW_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

/**
 * The member behind the session cookie, straight from the members table.
 *
 * Memoised per request: a page, the app shell around it and the role-preview
 * check all ask, and each used to be its own round trip to Supabase.
 */
export const getRealMember = cache(async (): Promise<Member | null> => {
  const session = await getSession();
  if (!session) return null;

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production" || session.governanceRoleAtSignIn === "admin") {
      return {
        id: session.memberId,
        email: session.email,
        full_name: session.name || "Hiker",
        membership_tier: session.membershipTierAtSignIn,
        governance_role: session.governanceRoleAtSignIn,
        is_walk_leader: session.wasWalkLeaderAtSignIn,
        membership_expires_at: null,
        synced_at: new Date().toISOString(),
        sync_source: "dev-session",
      };
    }
    return null;
  }

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
});

export async function getRolePreviewState(): Promise<{
  isRealAdmin: boolean;
  preview: RolePreviewConfig | null;
  realMember: Member | null;
}> {
  const realMember = await getRealMember();
  const isRealAdmin = realMember?.governance_role === "admin";
  if (!isRealAdmin) {
    return { isRealAdmin: false, preview: null, realMember: null };
  }
  const preview = await getRolePreview();
  return {
    isRealAdmin: true,
    preview: preview?.active ? preview : null,
    realMember,
  };
}

/**
 * Resolve access from Supabase on every privileged request. The access fields
 * captured at sign-in are display history only and never authorize a request.
 * If a real admin has activated role preview, permissions are overridden dynamically.
 */
export async function getCurrentMember(): Promise<Member | null> {
  const realMember = await getRealMember();
  if (!realMember) return null;

  // Only genuine admins can preview roles
  if (realMember.governance_role !== "admin") {
    return realMember;
  }

  const preview = await getRolePreview();
  if (!preview || !preview.active) {
    return realMember;
  }

  return {
    ...realMember,
    membership_tier: preview.membershipTier,
    governance_role: preview.governanceRole,
    is_walk_leader: Boolean(preview.isWalkLeader),
    is_preview: true,
    real_governance_role: "admin",
  };
}

export function sessionCookieName(): string {
  return COOKIE_NAME;
}

export function rolePreviewCookieName(): string {
  return ROLE_PREVIEW_COOKIE;
}
