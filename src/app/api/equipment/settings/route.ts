import { NextResponse } from "next/server";
import { can } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export async function GET() {
  const member = await getCurrentMember();
  if (
    !member ||
    !can(
      {
        membershipTier: member.membership_tier,
        governanceRole: member.governance_role,
        isWalkLeader: member.is_walk_leader,
      },
      "manage_equipment",
    )
  ) {
    return NextResponse.json({ error: "Forbidden: Committee access required" }, { status: 403 });
  }

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      const { getDevSheetSettings } = await import("@/lib/dev-store");
      const s = getDevSheetSettings();
      return NextResponse.json({
        webhookUrl: s.webhookUrl || process.env.GOOGLE_SHEET_WEBHOOK_URL || "",
        sheetId: s.sheetId || process.env.GOOGLE_SHEET_ID || "",
        configured: Boolean(s.webhookUrl || process.env.GOOGLE_SHEET_WEBHOOK_URL),
      });
    }
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("suu_session_settings")
    .select("session_id, auth_state")
    .eq("id", "google_sheets")
    .maybeSingle();

  const webhookUrl = data?.session_id || process.env.GOOGLE_SHEET_WEBHOOK_URL || "";
  const sheetId = data?.auth_state || process.env.GOOGLE_SHEET_ID || "";

  return NextResponse.json({
    webhookUrl,
    sheetId,
    configured: Boolean(webhookUrl),
  });
}

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
      "manage_equipment",
    )
  ) {
    return NextResponse.json({ error: "Forbidden: Committee access required" }, { status: 403 });
  }

  let body: { webhookUrl?: unknown; sheetId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const webhookUrl = typeof body.webhookUrl === "string" ? body.webhookUrl.trim() : "";
  const sheetId = typeof body.sheetId === "string" ? body.sheetId.trim() : "";

  if (webhookUrl && !webhookUrl.startsWith("https://script.google.com/")) {
    return NextResponse.json(
      { error: "Invalid Webhook URL: Must start with https://script.google.com/" },
      { status: 400 },
    );
  }

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      const { setDevSheetSettings } = await import("@/lib/dev-store");
      const updated = setDevSheetSettings({ webhookUrl, sheetId });
      return NextResponse.json({
        ok: true,
        webhookUrl: updated.webhookUrl,
        sheetId: updated.sheetId,
        message: "Google Sheets webhook configuration saved successfully.",
      });
    }
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { error } = await supabase.from("suu_session_settings").upsert({
    id: "google_sheets",
    session_id: webhookUrl,
    auth_state: sheetId || null,
    status: webhookUrl ? "active" : "unconfigured",
    updated_by: member.id,
    updated_at: now,
  });

  if (error) {
    return NextResponse.json({ error: "Failed to save Google Sheets settings" }, { status: 500 });
  }

  await supabase.from("audit_log").insert({
    actor_member_id: member.id,
    action: "configure_google_sheets_webhook",
    target_type: "system_settings",
    target_id: "google_sheets",
    metadata: { webhookConfigured: Boolean(webhookUrl), sheetId },
  });

  return NextResponse.json({
    ok: true,
    webhookUrl,
    sheetId,
    message: "Google Sheets webhook configuration saved successfully.",
  });
}
