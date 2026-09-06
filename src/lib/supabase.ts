import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * The service-role key is the only key that can reach these tables, so it is
 * the only one this checks for.
 *
 * It used to fall back to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, which cannot
 * work by construction: every table in
 * `supabase/migrations/20260904000000_initial_schema.sql` has RLS enabled and
 * `revoke all ... from anon, authenticated`, and no migration creates a single
 * policy. That is deliberate — identity comes from Toolbox rather than
 * Supabase Auth, so there is no `authenticated` role to write policies for and
 * every read goes through service_role behind the HttpOnly session check.
 *
 * The fallback's only effect was to make a missing service key look like a
 * working configuration: `isSupabaseConfigured()` returned true, callers
 * skipped their 503, and the queries came back empty.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY),
  );
}

/** Server-only client. Never import this module into a client component. */
export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase is not configured: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required",
    );
  }

  client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
