#!/usr/bin/env node
/**
 * Applies pending SQL migrations from `supabase/migrations/` during a Vercel
 * **production** build, so a schema change ships with the code that needs it.
 * Runs before `next build`; a failed migration fails the build and the previous
 * deployment keeps serving.
 *
 * Like adams-campus-toolbox `scripts/deploy-migrate.mjs`, this makes migrations
 * reliable, not zero-downtime: the old deployment serves while this runs, so a
 * rename, drop or new NOT NULL still needs expand/contract over two deploys.
 *
 * ## When it runs
 *
 * - `VERCEL_ENV=production` only. NODE_ENV is "production" for previews too, and
 *   a pull-request build must never touch the production database.
 * - Or explicitly, anywhere, with `MIGRATE_DATABASE_URL` set (`npm run db:migrate`).
 *
 * ## How it tracks what has run
 *
 * `public.schema_migrations` records each applied file by name with a sha256 of
 * its contents. Each migration runs in its own transaction together with its
 * ledger row, under a transaction-scoped advisory lock, so two concurrent builds
 * cannot both apply one, and a failure leaves neither the change nor the record.
 * Transaction-scoped rather than session locks so it also works through
 * Supabase's transaction pooler.
 *
 * ## The baseline
 *
 * The first two migrations were applied by hand before this existed. When the
 * ledger is first created, each entry in `BASELINE` is recorded as already
 * applied if **all** its marker tables exist, left pending if none do, and the
 * build fails if only some do — a half-applied migration needs a person.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { SUPABASE_ROOT_CA } from "./supabase-ca.mjs";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const LOCK_KEY = 7_311_902_614; // arbitrary, fixed: "hiking schema migrations"

/** Migrations applied by hand before the ledger existed, and tables that prove each ran. */
export const BASELINE = {
  "20260904000000_initial_schema": ["members", "walks", "walk_registrations", "member_sync_runs", "audit_log"],
  "20260904000001_suu_events_inventory": ["suu_session_settings", "events", "event_sync_runs", "equipment", "equipment_requests"],
};

const log = (message) => console.log(`▸ migrate: ${message}`);

function connectionCandidates() {
  if (process.env.MIGRATE_DATABASE_URL) return [["MIGRATE_DATABASE_URL", process.env.MIGRATE_DATABASE_URL]];
  // Session/direct first (DDL-friendly), then the transaction pooler.
  return ["POSTGRES_URL_NON_POOLING", "POSTGRES_URL"]
    .filter((name) => process.env[name])
    .map((name) => [name, process.env[name]]);
}

/**
 * pg lets `sslmode` in the URL override the `ssl` option, which would drop the
 * CA and verification. Strip the SSL query parameters and configure TLS here.
 */
function clientConfig(url) {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.startsWith("ssl") || key === "supa") parsed.searchParams.delete(key);
  }
  const local = ["localhost", "127.0.0.1", "::1", ""].includes(parsed.hostname) || parsed.hostname.startsWith("/");
  return {
    connectionString: parsed.toString(),
    ssl: local ? undefined : { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
    connectionTimeoutMillis: 15_000,
  };
}

async function connect() {
  const candidates = connectionCandidates();
  if (candidates.length === 0) {
    throw new Error("no database URL: set POSTGRES_URL_NON_POOLING (Vercel's Supabase integration) or MIGRATE_DATABASE_URL");
  }
  let lastError;
  for (const [name, url] of candidates) {
    const client = new pg.Client(clientConfig(url));
    try {
      await client.connect();
      log(`connected via ${name} (${new URL(url).host.replace(/^.*@/, "")})`);
      return client;
    } catch (error) {
      lastError = error;
      console.warn(`▸ migrate: could not connect via ${name}: ${error.message}`);
      await client.end().catch(() => {});
    }
  }
  throw lastError;
}

async function listMigrations() {
  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();
  return Promise.all(
    files.map(async (file) => {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      return { name: file.replace(/\.sql$/, ""), sql, checksum: createHash("sha256").update(sql).digest("hex") };
    }),
  );
}

async function ensureLedger(client, migrations) {
  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock($1)", [LOCK_KEY]);
    const { rows } = await client.query("select to_regclass('public.schema_migrations') is not null as present");
    if (rows[0].present) {
      await client.query("commit");
      return;
    }

    await client.query(`
      create table public.schema_migrations (
        name text primary key,
        checksum text not null,
        baseline boolean not null default false,
        applied_at timestamptz not null default now()
      );
      alter table public.schema_migrations enable row level security;
    `);

    for (const [name, markers] of Object.entries(BASELINE)) {
      const migration = migrations.find((m) => m.name === name);
      if (!migration) continue;
      const { rows: found } = await client.query(
        "select count(*)::int as n from unnest($1::text[]) as t(name) where to_regclass('public.' || t.name) is not null",
        [markers],
      );
      const present = found[0].n;
      if (present === markers.length) {
        await client.query(
          "insert into public.schema_migrations (name, checksum, baseline) values ($1, $2, true)",
          [name, migration.checksum],
        );
        log(`baseline: ${name} was already applied`);
      } else if (present > 0) {
        throw new Error(`${name} looks half-applied (${present}/${markers.length} of its tables exist); fix by hand`);
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function applyPending(client, migrations) {
  const { rows } = await client.query("select name, checksum from public.schema_migrations");
  const applied = new Map(rows.map((row) => [row.name, row.checksum]));

  for (const migration of migrations) {
    const recorded = applied.get(migration.name);
    if (recorded) {
      if (recorded !== migration.checksum) {
        console.warn(`▸ migrate: warning: ${migration.name} changed after it was applied; the change was NOT re-run`);
      }
      continue;
    }

    await client.query("begin");
    try {
      await client.query("select pg_advisory_xact_lock($1)", [LOCK_KEY]);
      const { rowCount } = await client.query("select 1 from public.schema_migrations where name = $1", [migration.name]);
      if (rowCount) {
        await client.query("commit");
        continue; // a concurrent build got there first
      }
      await client.query(migration.sql);
      await client.query("insert into public.schema_migrations (name, checksum) values ($1, $2)", [
        migration.name,
        migration.checksum,
      ]);
      await client.query("commit");
      log(`applied ${migration.name}`);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw new Error(`${migration.name} failed: ${error.message}`);
    }
  }
}

async function main() {
  if (process.env.VERCEL_ENV !== "production" && !process.env.MIGRATE_DATABASE_URL) {
    console.log(`↷ migrate: skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}, only "production" migrates)`);
    return;
  }

  const migrations = await listMigrations();
  const client = await connect();
  try {
    await ensureLedger(client, migrations);
    await applyPending(client, migrations);
    log("up to date");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`✗ migrate: ${error.message}`);
  process.exit(1);
});
