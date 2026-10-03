import { createSign } from "node:crypto";

/**
 * The site's Google service account, whose JSON key is in `GCP_SA_KEY`.
 * No SDK: a signed JWT is exchanged for an access token (see googleSheets.ts).
 */

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri: string;
}

/** The key from raw JSON or base64 JSON, or null if it isn't a usable service account key. */
export function parseServiceAccountKey(raw: string | undefined): ServiceAccountKey | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const json = trimmed.startsWith("{") ? trimmed : Buffer.from(trimmed, "base64").toString("utf8");
  try {
    const key = JSON.parse(json) as Partial<ServiceAccountKey> & { type?: string };
    if (key.type !== "service_account" || !key.client_email || !key.private_key || !key.project_id) return null;
    return {
      client_email: key.client_email,
      private_key: key.private_key,
      project_id: key.project_id,
      token_uri: key.token_uri || "https://oauth2.googleapis.com/token",
    };
  } catch {
    return null;
  }
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** An RS256 JWT assertion for Google's OAuth token endpoint. */
export function signAssertion(
  key: ServiceAccountKey,
  nowSeconds = Math.floor(Date.now() / 1000),
  scope = "https://www.googleapis.com/auth/cloud-platform",
): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope,
      aud: key.token_uri,
      iat: nowSeconds,
      exp: nowSeconds + 600,
    }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(key.private_key);
  return `${header}.${claims}.${b64url(signature)}`;
}
