import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import {
  canPreviewAs,
  canPreviewRoles,
  isGovernanceRole,
  isMembershipTier,
  previewableGovernanceRoles,
  type GovernanceRole,
  type MembershipTier,
} from "@/lib/access";
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

/**
 * The raw preview cookie, shape-checked but NOT authorised.
 *
 * The cookie is plain, unsigned JSON, so anyone can write anything into it.
 * Never use this to decide access: go through getCurrentMember() or
 * getRolePreviewState(), which check it against the real member on every read.
 */
export async function getRolePreview(): Promise<RolePreviewConfig | null> {
  try {
    const raw = (await cookies()).get(ROLE_PREVIEW_COOKIE)?.value;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    // The old "public visitor" preview hid the admin's own session, and with it
    // the menu to leave the preview. Treat any such cookie as no preview at all.
    if (parsed.simulateSignedOut) return null;
    if (parsed.active !== true) return null;
    if (!isMembershipTier(parsed.membershipTier)) return null;
    if (parsed.governanceRole !== null && !isGovernanceRole(parsed.governanceRole)) return null;
    return {
      active: true,
      membershipTier: parsed.membershipTier,
      governanceRole: parsed.governanceRole,
      isWalkLeader: parsed.isWalkLeader === true,
    };
  } catch {
    return null;
  }
}

/**
 * The preview that applies to this member, or null. Re-checked on every read
 * against the member's real role from the database: a preview above that role
 * (a principal's cookie claiming "admin", or any cookie on a member who can't
 * preview at all) is ignored outright.
 */
async function authorisedPreview(realMember: Member): Promise<RolePreviewConfig | null> {
  if (!canPreviewRoles(realMember.governance_role)) return null;
  const preview = await getRolePreview();
  if (!preview) return null;
  if (!canPreviewAs(realMember.governance_role, preview.governanceRole)) return null;
  return preview;
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

export interface RolePreviewState {
  /** The real member (not the preview) may use role preview. */
  canPreviewRoles: boolean;
  /** The real member is an admin. Kept for callers that need admin specifically. */
  isRealAdmin: boolean;
  /** Governance roles this member may preview as (null = no role). */
  previewableRoles: (GovernanceRole | null)[];
  preview: RolePreviewConfig | null;
  realMember: Member | null;
}

export async function getRolePreviewState(): Promise<RolePreviewState> {
  const realMember = await getRealMember();
  if (!realMember || !canPreviewRoles(realMember.governance_role)) {
    return {
      canPreviewRoles: false,
      isRealAdmin: false,
      previewableRoles: [],
      preview: null,
      realMember: null,
    };
  }
  return {
    canPreviewRoles: true,
    isRealAdmin: realMember.governance_role === "admin",
    previewableRoles: previewableGovernanceRoles(realMember.governance_role),
    preview: await authorisedPreview(realMember),
    realMember,
  };
}

/**
 * Resolve access from Supabase on every privileged request. The access fields
 * captured at sign-in are display history only and never authorize a request.
 * If an admin or principal has activated role preview, permissions are
 * overridden, but never above their own real role, and the member's id, email
 * and name stay their own, so anything recorded against them (audit actors,
 * bookings, deletions) is still the real person.
 */
export async function getCurrentMember(): Promise<Member | null> {
  const realMember = await getRealMember();
  if (!realMember) return null;

  const preview = await authorisedPreview(realMember);
  if (!preview) return realMember;

  return {
    ...realMember,
    membership_tier: preview.membershipTier,
    governance_role: preview.governanceRole,
    is_walk_leader: preview.isWalkLeader,
    is_preview: true,
    real_governance_role: realMember.governance_role,
  };
}

export function sessionCookieName(): string {
  return COOKIE_NAME;
}

export function rolePreviewCookieName(): string {
  return ROLE_PREVIEW_COOKIE;
}
