import { createHmac, randomUUID } from "node:crypto";

/**
 * Expense claims go from the member's browser straight to an Apps Script web
 * app on the treasurer's reimbursement spreadsheet, so bank details never pass
 * through this app. The app's only part is vouching for who is claiming: a
 * short-lived token the script checks before it writes a row.
 *
 * Token: base64url(JSON claims) + "." + base64url(HMAC-SHA256(that first part,
 * secret)), no padding. `apps-script/reimbursements/Code.gs` verifies exactly
 * this; change both together.
 */

export type ClaimKind = "wl" | "committee";

export interface ClaimTokenClaims {
  /** Member id. */
  sub: string;
  email: string;
  name: string;
  kind: ClaimKind;
  /** Seconds since the epoch. */
  iat: number;
  exp: number;
  /** One use: the script remembers it until it expires. */
  jti: string;
}

export const CLAIM_TOKEN_TTL_SECONDS = 600;

export function isClaimKind(value: unknown): value is ClaimKind {
  return value === "wl" || value === "committee";
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

export function signClaimToken(
  claims: Omit<ClaimTokenClaims, "iat" | "exp" | "jti">,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  jti: string = randomUUID(),
): string {
  const body: ClaimTokenClaims = { ...claims, iat: nowSeconds, exp: nowSeconds + CLAIM_TOKEN_TTL_SECONDS, jti };
  return sign(body, secret);
}

function sign(body: object, secret: string): string {
  const payload = b64url(JSON.stringify(body));
  const signature = createHmac("sha256", secret).update(payload, "utf8").digest();
  return `${payload}.${b64url(signature)}`;
}

/** The scope of the server's own pass for reading which walks have claims; never handed to a browser. */
export const WL_CLAIMS_READ_SCOPE = "wl-claims";
export const READ_TOKEN_TTL_SECONDS = 60;

/**
 * A one-minute pass for the app's server to ask the script which walk-leader
 * claims the spreadsheet holds (dates and names only, no bank details). Same
 * format as a claim token; the script tells them apart by `scope`.
 */
export function signReadToken(secret: string, nowSeconds = Math.floor(Date.now() / 1000), jti: string = randomUUID()): string {
  return sign({ scope: WL_CLAIMS_READ_SCOPE, iat: nowSeconds, exp: nowSeconds + READ_TOKEN_TTL_SECONDS, jti }, secret);
}
