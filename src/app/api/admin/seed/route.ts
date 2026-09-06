import { NextResponse } from "next/server";
import { Client } from "pg";

const SEED_SECRET = "ucl-hiking-seed-2026";

export async function POST(request: Request) {
  const secret = request.headers.get("x-seed-secret");
  if (secret !== SEED_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connectionString =
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_PRISMA_URL;

  if (!connectionString) {
    return NextResponse.json(
      { error: "No POSTGRES_URL configured" },
      { status: 500 },
    );
  }

  let cleanConnectionString = connectionString;
  try {
    const parsed = new URL(cleanConnectionString);
    parsed.searchParams.delete("sslmode");
    cleanConnectionString = parsed.toString();
  } catch {}

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  const client = new Client({
    connectionString: cleanConnectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const admins = [
      { email: "adam.cleary.24@ucl.ac.uk", name: "Adam Cleary" },
      { email: "apple@adamscampustoolbox.org.uk", name: "Apple Reviewer" },
      { email: "android@adamscampustoolbox.org.uk", name: "Android Reviewer" },
    ];

    for (const a of admins) {
      await client.query(
        `INSERT INTO public.members (email, full_name, membership_tier, governance_role, is_walk_leader, sync_source)
         VALUES ($1, $2, 'explorer', 'admin', true, 'toolbox-admin')
         ON CONFLICT (email) DO UPDATE 
         SET governance_role = 'admin',
             membership_tier = 'explorer',
             is_walk_leader = true,
             revoked_at = null;`,
        [a.email, a.name],
      );
    }

    const { rows } = await client.query(
      `SELECT id, email, full_name, membership_tier, governance_role, is_walk_leader FROM public.members;`,
    );

    return NextResponse.json({ ok: true, members: rows });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}
