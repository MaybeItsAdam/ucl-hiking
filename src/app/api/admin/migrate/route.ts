import { NextResponse } from "next/server";
import { Client } from "pg";

const MIGRATION_SECRET = "ucl-hiking-setup-20260906";

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE public.membership_tier AS ENUM ('taster', 'standard', 'explorer');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.governance_role AS ENUM ('committee', 'principal', 'admin');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.walk_difficulty AS ENUM ('easy', 'moderate', 'challenging');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.walk_visibility AS ENUM ('public', 'members', 'explorers');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS public.members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  full_name text,
  toolbox_user_id text UNIQUE,
  membership_tier public.membership_tier NOT NULL,
  governance_role public.governance_role,
  is_walk_leader boolean NOT NULL DEFAULT false,
  membership_expires_at timestamptz,
  source_reference text,
  sync_source text NOT NULL DEFAULT 'ucl-suu-membership-job',
  synced_at timestamptz NOT NULL DEFAULT now(),
  last_signed_in_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.walks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  location text NOT NULL,
  starts_at timestamptz NOT NULL,
  distance_km numeric(5, 1) NOT NULL CHECK (distance_km > 0),
  ascent_m integer NOT NULL CHECK (ascent_m >= 0),
  difficulty public.walk_difficulty NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0),
  spaces_remaining integer NOT NULL CHECK (
    spaces_remaining >= 0 AND spaces_remaining <= capacity
  ),
  visibility public.walk_visibility NOT NULL DEFAULT 'members',
  summary text,
  leader_member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.walk_registrations (
  walk_id uuid NOT NULL REFERENCES public.walks(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'waitlist', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (walk_id, member_id)
);

CREATE TABLE IF NOT EXISTS public.member_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  received_count integer NOT NULL,
  upserted_count integer NOT NULL,
  revoked_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS members_active_email_idx ON public.members (email) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS walks_upcoming_idx ON public.walks (starts_at) WHERE published = true;
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON public.audit_log (created_at DESC);

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.walks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.walk_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.members FROM anon, authenticated;
REVOKE ALL ON public.walks FROM anon, authenticated;
REVOKE ALL ON public.walk_registrations FROM anon, authenticated;
REVOKE ALL ON public.member_sync_runs FROM anon, authenticated;
REVOKE ALL ON public.audit_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS members_set_updated_at ON public.members;
CREATE TRIGGER members_set_updated_at BEFORE UPDATE ON public.members
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS walks_set_updated_at ON public.walks;
CREATE TRIGGER walks_set_updated_at BEFORE UPDATE ON public.walks
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS registrations_set_updated_at ON public.walk_registrations;
CREATE TRIGGER registrations_set_updated_at BEFORE UPDATE ON public.walk_registrations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Migration 2
CREATE TABLE IF NOT EXISTS public.suu_session_settings (
  id text PRIMARY KEY DEFAULT 'default',
  session_id text,
  auth_state text,
  status text NOT NULL DEFAULT 'unconfigured' CHECK (status IN ('active', 'expired', 'error', 'unconfigured')),
  last_error text,
  last_checked_at timestamptz,
  updated_by uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suu_event_id text UNIQUE,
  title text NOT NULL,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'sold_out', 'cancelled', 'completed', 'draft')),
  capacity integer NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  tickets_sold integer NOT NULL DEFAULT 0 CHECK (tickets_sold >= 0),
  price_pence integer NOT NULL DEFAULT 0 CHECK (price_pence >= 0),
  source_reference text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  received_count integer NOT NULL,
  upserted_count integer NOT NULL,
  status text NOT NULL DEFAULT 'success',
  error_message text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL,
  description text,
  total_quantity integer NOT NULL CHECK (total_quantity >= 0),
  available_quantity integer NOT NULL CHECK (available_quantity >= 0 AND available_quantity <= total_quantity),
  condition text NOT NULL DEFAULT 'good' CHECK (condition IN ('excellent', 'good', 'fair', 'needs_repair')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.equipment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  start_date date NOT NULL,
  end_date date NOT NULL CHECK (end_date >= start_date),
  purpose text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'returned', 'cancelled')),
  notes text,
  reviewed_by uuid REFERENCES public.members(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.suu_session_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.suu_session_settings FROM anon, authenticated;
REVOKE ALL ON public.events FROM anon, authenticated;
REVOKE ALL ON public.event_sync_runs FROM anon, authenticated;
REVOKE ALL ON public.equipment FROM anon, authenticated;
REVOKE ALL ON public.equipment_requests FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS events_starts_at_idx ON public.events (starts_at DESC);
CREATE INDEX IF NOT EXISTS equipment_requests_member_idx ON public.equipment_requests (member_id);
CREATE INDEX IF NOT EXISTS equipment_requests_status_idx ON public.equipment_requests (status);

DROP TRIGGER IF EXISTS suu_session_settings_set_updated_at ON public.suu_session_settings;
CREATE TRIGGER suu_session_settings_set_updated_at BEFORE UPDATE ON public.suu_session_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS events_set_updated_at ON public.events;
CREATE TRIGGER events_set_updated_at BEFORE UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS equipment_set_updated_at ON public.equipment;
CREATE TRIGGER equipment_set_updated_at BEFORE UPDATE ON public.equipment
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS equipment_requests_set_updated_at ON public.equipment_requests;
CREATE TRIGGER equipment_requests_set_updated_at BEFORE UPDATE ON public.equipment_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
`;

export async function POST(request: Request) {
  const secret = request.headers.get("x-migration-secret");
  if (secret !== MIGRATION_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connectionString =
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_PRISMA_URL;

  if (!connectionString) {
    return NextResponse.json(
      { error: "No POSTGRES_URL configured in environment" },
      { status: 500 },
    );
  }

  let body: { adminEmail?: string; adminName?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query(SCHEMA_SQL);

    if (body.adminEmail) {
      await client.query(
        `INSERT INTO public.members (email, full_name, membership_tier, governance_role, is_walk_leader)
         VALUES ($1, $2, 'standard', 'admin', true)
         ON CONFLICT (email) DO UPDATE SET governance_role = 'admin';`,
        [body.adminEmail.trim().toLowerCase(), body.adminName || "Admin"],
      );
    }

    const { rows: tableRows } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;`,
    );

    const { rows: memberRows } = await client.query(
      `SELECT count(*)::int as count FROM public.members;`,
    );

    return NextResponse.json({
      ok: true,
      tables: tableRows.map((r) => r.tablename),
      memberCount: memberRows[0]?.count ?? 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}
