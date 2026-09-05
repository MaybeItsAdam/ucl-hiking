import { exec } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { can } from "@/lib/access";
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

  let body: { target?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const target = String(body.target || "all");
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
  };

  try {
    let output = "";
    if (process.env.NODE_ENV === "development" || process.env.ENABLE_LOCAL_SYNC_EXEC === "true") {
      const pythonCmd = "cloud-jobs/.venv/bin/python3 -m hiking_sync";
      const { stdout, stderr } = await execAsync(pythonCmd, {
        cwd: process.cwd() + "/cloud-jobs",
        env: envVars,
      });
      output = stdout || stderr;
    } else {
      output = "Sync triggered in cloud job worker";
    }

    await supabase.from("audit_log").insert({
      actor_member_id: member.id,
      action: "trigger_sync",
      target_type: "sync",
      target_id: target,
      metadata: { triggered_by: member.email, target, output_snippet: output.slice(0, 200) },
    });

    return NextResponse.json({ ok: true, message: `Sync for '${target}' triggered successfully.`, output });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    
    await supabase.from("suu_session_settings").upsert({
      id: "default",
      status: errorMsg.toLowerCase().includes("login") || errorMsg.toLowerCase().includes("denied") || errorMsg.toLowerCase().includes("expired") ? "expired" : "error",
      last_error: errorMsg.slice(0, 500),
      last_checked_at: new Date().toISOString(),
    });

    return NextResponse.json(
      { error: "Sync execution encountered an error: " + errorMsg, details: errorMsg },
      { status: 500 },
    );
  }
}
