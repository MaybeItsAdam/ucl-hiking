#!/usr/bin/env node
/**
 * Check a Doppler config has every secret the app needs, in a shape that works,
 * before a deploy finds out the hard way. Values are read in memory and never
 * printed.
 *
 *   npm run env:check            # dev
 *   npm run env:check -- prd     # production
 *   npm run env:check -- ci      # GitHub Actions
 */
import { execFileSync } from "node:child_process";

const config = process.argv[2] ?? "dev";

/**
 * What each config must hold. Production's Supabase and Postgres variables are
 * written into Vercel by the Supabase integration, so they are not Doppler's to hold.
 */
const REQUIRED = {
  dev: ["SESSION_SECRET", "TOOLBOX_URL", "CRON_SECRET", "MEMBER_SYNC_SECRET"],
  prd: [
    "SESSION_SECRET",
    "SAFETY_DATA_KEY",
    "CRON_SECRET",
    "MEMBER_SYNC_SECRET",
    "TOOLBOX_URL",
    "TOOLBOX_API_TOKEN",
    "TOOLBOX_ORGANISER_ID",
    "TOOLBOX_WEBHOOK_SECRET",
  ],
  ci: ["ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD", "PLAY_SERVICE_ACCOUNT_JSON"],
};

/** Shape checks for the ones that break quietly when pasted wrong. */
const SHAPE = {
  SESSION_SECRET: (v) => v.length >= 32 || "must be at least 32 characters",
  SAFETY_DATA_KEY: (v) => Buffer.from(v, "base64").length === 32 || "must be 32 bytes, base64 (openssl rand -base64 32)",
  FIREBASE_SERVICE_ACCOUNT: (v) => {
    const text = v.trim().startsWith("{") ? v : Buffer.from(v, "base64").toString("utf8");
    try {
      const json = JSON.parse(text);
      return (json.client_email && json.private_key) || "is JSON but has no client_email/private_key";
    } catch {
      return "must be the service-account JSON, raw or base64";
    }
  },
  PLAY_SERVICE_ACCOUNT_JSON: (v) => {
    try {
      return JSON.parse(v).type === "service_account" || "is not a service-account JSON";
    } catch {
      return "must be the raw service-account JSON";
    }
  },
  GOOGLE_SERVICES_JSON_BASE64: (v) => {
    try {
      return Boolean(JSON.parse(Buffer.from(v, "base64").toString("utf8")).project_info) || "is not a google-services.json";
    } catch {
      return "must be google-services.json, base64-encoded";
    }
  },
  NEXT_PUBLIC_PUSH_ENABLED: (v, all) => v !== "true" || Boolean(all.FIREBASE_SERVICE_ACCOUNT) || "is true but FIREBASE_SERVICE_ACCOUNT is missing",
};

if (!REQUIRED[config]) {
  console.error(`Unknown config "${config}". Use one of: ${Object.keys(REQUIRED).join(", ")}.`);
  process.exit(2);
}

let secrets;
try {
  const out = execFileSync("doppler", ["secrets", "download", "--no-file", "--format", "json", "-p", "ucl-hiking", "-c", config], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  secrets = JSON.parse(out);
} catch (e) {
  console.error(`Couldn't read Doppler config "${config}". Run \`doppler login\` first.\n${e.stderr ?? e.message}`);
  process.exit(2);
}

const problems = [];
for (const name of REQUIRED[config]) {
  if (!secrets[name]?.trim()) problems.push(`${name} is missing`);
}
for (const [name, check] of Object.entries(SHAPE)) {
  const value = secrets[name];
  if (!value) continue;
  const result = check(value, secrets);
  if (result !== true) problems.push(`${name} ${result}`);
}

if (problems.length) {
  console.error(`✗ ${config}: ${problems.length} problem${problems.length === 1 ? "" : "s"}`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`✓ ${config}: ${REQUIRED[config].length} required secrets present, shapes check out`);
