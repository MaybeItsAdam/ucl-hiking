import { NextResponse } from "next/server";
import { cronBearerMatches, cronOrCommittee } from "@/lib/cronAuth";
import { isSupabaseConfigured } from "@/lib/supabase";
import { pullWalkSheet } from "@/lib/walkSheetSync";

/**
 * Read the committee calendar, the hike planning tab, the WL sign-ups and the
 * WL roster into the app (see lib/walkSheetSync). Vercel Cron calls it; the
 * committee's "Sync now" and opening the Programme page do too.
 */
export const maxDuration = 120;

async function run(request: Request) {
  if (!(await cronOrCommittee(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  try {
    const result = await pullWalkSheet(cronBearerMatches(request.headers.get("authorization")) ? "cron" : "manual");
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export const GET = run;
export const POST = run;
