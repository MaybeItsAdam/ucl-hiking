import { createSign } from "node:crypto";

/**
 * Starting a Cloud Run job from the site (the committee "Sync now" button),
 * authenticated as a service account whose JSON key is in `GCP_SA_KEY`.
 * No SDK: a signed JWT exchanged for an access token, then one REST call.
 */

export const ROSTER_SYNC_JOB = "hiking-roster-sync";
export const CLOUD_RUN_REGION = "europe-west2";

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
export function signAssertion(key: ServiceAccountKey, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: key.token_uri,
      iat: nowSeconds,
      exp: nowSeconds + 600,
    }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(key.private_key);
  return `${header}.${claims}.${b64url(signature)}`;
}

export class CloudRunError extends Error {}

/** Start one execution of a Cloud Run job. Returns the execution's short name. */
export async function runCloudRunJob(job: string, key: ServiceAccountKey): Promise<string> {
  const tokenResponse = await fetch(key.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signAssertion(key),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const token = (await tokenResponse.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenResponse.ok || !token.access_token) {
    throw new CloudRunError(`Google rejected the service account key (HTTP ${tokenResponse.status})`);
  }

  const url = `https://run.googleapis.com/v2/projects/${key.project_id}/locations/${CLOUD_RUN_REGION}/jobs/${job}:run`;
  const runResponse = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(15_000),
  });
  const operation = (await runResponse.json().catch(() => ({}))) as {
    metadata?: { name?: string };
    error?: { message?: string };
  };
  if (!runResponse.ok) {
    throw new CloudRunError(`Cloud Run refused to start ${job} (HTTP ${runResponse.status}): ${operation.error?.message ?? ""}`.trim());
  }
  return operation.metadata?.name?.split("/").pop() ?? job;
}
