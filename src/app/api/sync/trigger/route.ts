import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { can } from "@/lib/access";
import { parseServiceAccountKey, ROSTER_SYNC_JOB, runCloudRunJob } from "@/lib/cloudRun";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";

const execAsync = promisify(exec);

export async function POST(request: Request) {
  const member = await getCurrentMember();
  if (
    !member ||
    !can(
      {
        membershipTier: member.membership_tier,
        governanceRole: member.governance_role,
        isWalkLeader: member.is_walk_leader,
      },
      "trigger_sync",
    )
  ) {
    return NextResponse.json({ error: "Forbidden: Committee access required" }, { status: 403 });
  }

  let body: { target?: unknown; group?: unknown; society?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const target = String(body.target || "all");
  const customSociety =
    typeof (body.group || body.society) === "string" && String(body.group || body.society).trim()
      ? String(body.group || body.society).trim()
      : null;

  // The receiving routes compare this secret and fail closed, so an unset value in
  // production reports a successful trigger for a sync that is rejected on arrival.
  if (!process.env.MEMBER_SYNC_SECRET && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Sync is not configured: MEMBER_SYNC_SECRET is not set" },
      { status: 503 },
    );
  }

  const { isSupabaseConfigured } = await import("@/lib/supabase");
  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      const { triggerDevSyncRun } = await import("@/lib/dev-store");
      const res = triggerDevSyncRun(target as "members" | "events" | "all");
      return NextResponse.json({ ok: true, message: res.message, output: "Simulated sync in dev environment." });
    }
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const supabase = getSupabaseAdmin();

  const { data: sessionSetting } = await supabase
    .from("suu_session_settings")
    .select("session_id, auth_state, status")
    .eq("id", "default")
    .maybeSingle();

  if (sessionSetting?.status === "expired") {
    return NextResponse.json(
      {
        error: "SU session has expired. A Principal member must update the session ID in settings before sync can run.",
        sessionExpired: true,
      },
      { status: 400 },
    );
  }

  const envVars = {
    ...process.env,
    HIKING_WEB_URL: process.env.HIKING_WEB_URL || "http://localhost:3000",
    MEMBER_SYNC_SECRET: process.env.MEMBER_SYNC_SECRET || "local-dev-sync-secret",
    SUU_SESSION_ID: sessionSetting?.session_id || process.env.SUU_SESSION_ID || "",
    SUU_AUTH_STATE_BASE64: sessionSetting?.auth_state || process.env.SUU_AUTH_STATE_BASE64 || "",
    ...(customSociety ? { SUU_GROUP: customSociety } : {}),
  };

  const localExec = process.env.NODE_ENV === "development" || process.env.ENABLE_LOCAL_SYNC_EXEC === "true";

  try {
    let output = "";
    if (localExec) {
      const cloudJobsDir = path.resolve(process.cwd(), "cloud-jobs");
      const venvPython = path.resolve(cloudJobsDir, ".venv/bin/python3");
      const pythonBin = fs.existsSync(venvPython) ? venvPython : "python3";
      const { stdout, stderr } = await execAsync(`"${pythonBin}" -m hiking_sync.roster_sync`, {
        cwd: cloudJobsDir,
        env: {
          ...envVars,
          PYTHONPATH: path.resolve(cloudJobsDir, "src") + (process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ""),
        },
      });
      output = stdout || stderr;
    } else {
      if (target === "events") {
        return NextResponse.json(
          { error: "There is no events sync job yet, so events can't be refreshed from here." },
          { status: 400 },
        );
      }
      const key = parseServiceAccountKey(process.env.GCP_SA_KEY);
      if (!key) {
        return NextResponse.json(
          { error: "The sync button isn't configured (GCP_SA_KEY). The daily member sync still runs at 06:30." },
          { status: 503 },
        );
      }
      const execution = await runCloudRunJob(ROSTER_SYNC_JOB, key);
      output = `Started member sync (${execution}). Results appear here within a minute or two.`;
    }

    await supabase.from("audit_log").insert({
      actor_member_id: member.id,
      action: "trigger_sync",
      target_type: "sync",
      target_id: target,
      metadata: {
        triggered_by: member.email,
        target,
        society: customSociety || "Hiking Club",
        output_snippet: output.slice(0, 200),
      },
    });

    return NextResponse.json({
      ok: true,
      message: localExec ? `Member sync for Hiking Club ran.` : output,
      output,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Only a local run reads the SU site from here; a Cloud Run API error says nothing about the SU login.
    if (localExec && errorMsg.includes("redirected to the login page")) {
      await supabase.from("suu_session_settings").upsert({
        id: "default",
        status: "expired",
        last_error: errorMsg.slice(0, 500),
        last_checked_at: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      { error: "Sync could not be started: " + errorMsg, details: errorMsg },
      { status: 500 },
    );
  }
}
