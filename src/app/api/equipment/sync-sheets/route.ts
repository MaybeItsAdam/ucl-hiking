import { NextResponse } from "next/server";
import { can } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

interface EquipmentRow {
  id: string;
  name: string;
  category: string;
  description: string | null;
  total_quantity: number;
  available_quantity: number;
  condition: string;
  updated_at: string;
}

interface EquipmentRequestRow {
  id: string;
  created_at: string;
  start_date: string;
  end_date: string;
  quantity: number;
  purpose: string;
  status: string;
  notes: string | null;
  reviewed_by: string | null;
  member?: {
    id: string;
    email: string;
    full_name: string | null;
    membership_tier: string;
  };
  equipment?: {
    id: string;
    name: string;
  };
}

function cleanSheetId(idOrUrl: string): string {
  if (!idOrUrl) return "";
  const match = idOrUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) return match[1];
  return idOrUrl.trim();
}

function buildEquipmentMasterRows(items: EquipmentRow[]): string[][] {
  const header = [
    "Equipment ID",
    "Item Name",
    "Category",
    "Description",
    "Total Quantity",
    "Available Quantity",
    "On Loan Quantity",
    "Condition",
    "Last Updated",
  ];
  const rows = [header];
  for (const item of items) {
    const total = item.total_quantity || 0;
    const avail = item.available_quantity || 0;
    const onLoan = Math.max(0, total - avail);
    rows.push([
      item.id || "",
      item.name || "",
      item.category || "General",
      item.description || "",
      String(total),
      String(avail),
      String(onLoan),
      item.condition || "good",
      item.updated_at || "",
    ]);
  }
  return rows;
}

function buildEquipmentLedgerRows(requests: EquipmentRequestRow[]): string[][] {
  const header = [
    "Request ID",
    "Timestamp",
    "Member Name",
    "Member Email",
    "Membership Tier",
    "Equipment Item",
    "Qty",
    "Start Date",
    "End Date",
    "Purpose",
    "Status",
    "Reviewed By",
    "Notes",
  ];
  const rows = [header];
  for (const req of requests) {
    rows.push([
      req.id || "",
      req.created_at || "",
      req.member?.full_name || "",
      req.member?.email || "",
      req.member?.membership_tier || "",
      req.equipment?.name || "",
      String(req.quantity || 1),
      req.start_date || "",
      req.end_date || "",
      req.purpose || "",
      req.status || "pending",
      req.reviewed_by || "",
      req.notes || "",
    ]);
  }
  return rows;
}

function buildDashboardRows(): string[][] {
  return [
    ["🏔️ UCL HIKING CLUB · GEAR LOCKER BASECAMP", "", ""],
    ["Two-Way Synchronized Fleet Telemetry · Live Equipment Tracking", "", ""],
    ["FLEET METRICS SUMMARY", "VALUE / FORMULA", "DESCRIPTION"],
    ["Total Gear Varieties", "=COUNTA('Master List'!A2:A)", "Total unique equipment models cataloged"],
    ["Total Units in Fleet", "=SUM('Master List'!E2:E)", "Aggregate quantity of all gear owned"],
    ["Units in Storage (Available)", "=SUM('Master List'!F2:F)", "Units currently available for checkout in locker"],
    ["Units Currently on Trail", "=SUM('Master List'!G2:G)", "Active items borrowed by club members"],
    ["Items Flagged for Repair", '=COUNTIF(\'Master List\'!H2:H, "needs_repair")', "Equipment requiring maintenance or replacement"],
    ["Pending Loan Requests", '=COUNTIF(\'Ledger Log\'!K2:K, "pending")', "Requests awaiting committee review"],
    ["Active Approved Loans", '=COUNTIF(\'Ledger Log\'!K2:K, "approved")', "Kit currently out on trail"],
    ["", "", ""],
    ["EQUIPMENT CATEGORY BREAKDOWN", "VARIETY COUNT", "TOTAL UNITS"],
    ["Tents & Shelter", '=COUNTIF(\'Master List\'!C2:C, "Tents & Shelter")', '=SUMIF(\'Master List\'!C2:C, "Tents & Shelter", \'Master List\'!E2:E)'],
    ["Footwear & Boots", '=COUNTIF(\'Master List\'!C2:C, "Footwear & Boots")', '=SUMIF(\'Master List\'!C2:C, "Footwear & Boots", \'Master List\'!E2:E)'],
    ["Rucksacks & Bags", '=COUNTIF(\'Master List\'!C2:C, "Rucksacks & Bags")', '=SUMIF(\'Master List\'!C2:C, "Rucksacks & Bags", \'Master List\'!E2:E)'],
    ["Navigation & Safety", '=COUNTIF(\'Master List\'!C2:C, "Navigation & Safety")', '=SUMIF(\'Master List\'!C2:C, "Navigation & Safety", \'Master List\'!E2:E)'],
    ["Cooking & Stoves", '=COUNTIF(\'Master List\'!C2:C, "Cooking & Stoves")', '=SUMIF(\'Master List\'!C2:C, "Cooking & Stoves", \'Master List\'!E2:E)'],
    ["Sleeping Gear", '=COUNTIF(\'Master List\'!C2:C, "Sleeping Gear")', '=SUMIF(\'Master List\'!C2:C, "Sleeping Gear", \'Master List\'!E2:E)'],
    ["General & Other", '=COUNTIF(\'Master List\'!C2:C, "General & Other")', '=SUMIF(\'Master List\'!C2:C, "General & Other", \'Master List\'!E2:E)'],
  ];
}

export async function POST(request: Request) {
  let body: {
    direction?: "push" | "pull";
    sheetRows?: unknown[][];
  } = {};

  try {
    const text = await request.text();
    if (text) {
      body = JSON.parse(text);
    }
  } catch {
    // defaults to push
  }

  const member = await getCurrentMember();

  // If request doesn't come with user session, allow if internal secret or dev mode
  const isAuthorized =
    member &&
    can(
      {
        membershipTier: member.membership_tier,
        governanceRole: member.governance_role,
        isWalkLeader: member.is_walk_leader,
      },
      "manage_equipment",
    );

  if (!isAuthorized && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Forbidden: Committee access required" }, { status: 403 });
  }

  let sheetId = process.env.GOOGLE_SHEET_ID || "";
  let sheetWebhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL || "";

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      const { getDevSheetSettings } = await import("@/lib/dev-store");
      const s = getDevSheetSettings();
      if (s.webhookUrl) sheetWebhookUrl = s.webhookUrl;
      if (s.sheetId) sheetId = s.sheetId;
    }
  } else {
    const supabase = getSupabaseAdmin();
    const { data: sData } = await supabase
      .from("suu_session_settings")
      .select("session_id, auth_state")
      .eq("id", "google_sheets")
      .maybeSingle();

    if (sData?.session_id) {
      sheetWebhookUrl = sData.session_id;
    }
    if (sData?.auth_state) {
      sheetId = sData.auth_state;
    }
  }

  // =========================================================================
  // 1. DIRECTION: PULL (Google Sheets -> Web App Database)
  // =========================================================================
  if (body.direction === "pull") {
    let rowsToImport: unknown[][] = [];

    if (Array.isArray(body.sheetRows) && body.sheetRows.length > 0) {
      rowsToImport = body.sheetRows;
    } else if (sheetWebhookUrl) {
      try {
        const pullUrl = new URL(sheetWebhookUrl);
        const resolvedId = cleanSheetId(sheetId);
        if (resolvedId) {
          pullUrl.searchParams.set("sheetId", resolvedId);
        }
        const response = await fetch(pullUrl.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
          redirect: "follow",
        });
        if (!response.ok) {
          return NextResponse.json(
            { error: `Google Sheet webhook responded with HTTP ${response.status}` },
            { status: 502 },
          );
        }
        const data = await response.json();
        if (data.status === "error") {
          return NextResponse.json(
            { error: `Google Sheet error: ${data.message}` },
            { status: 502 },
          );
        }
        if (Array.isArray(data.equipmentMaster)) {
          rowsToImport = data.equipmentMaster;
        }
      } catch (err: unknown) {
        return NextResponse.json(
          { error: `Error pulling from Google Sheet: ${err instanceof Error ? err.message : String(err)}` },
          { status: 502 },
        );
      }
    } else {
      return NextResponse.json(
        { error: "GOOGLE_SHEET_WEBHOOK_URL is not configured in environment variables." },
        { status: 400 },
      );
    }

    if (rowsToImport.length <= 1) {
      return NextResponse.json({
        ok: true,
        direction: "pull",
        importedCount: 0,
        message: "Google Sheet 'Master List' contained no data rows to import.",
      });
    }

    let importedCount = 0;
    const now = new Date().toISOString();

    for (let i = 1; i < rowsToImport.length; i++) {
      const row = rowsToImport[i];
      if (!Array.isArray(row) || row.length < 2) continue;

      const rawId = row[0] ? String(row[0]).trim() : "";
      const name = String(row[1] || "").trim();
      if (!name) continue;

      const category = String(row[2] || "General").trim();
      const description = row[3] ? String(row[3]).trim() : null;
      const totalQty = Math.max(1, parseInt(String(row[4])) || 1);
      const availQty = Math.min(totalQty, Math.max(0, parseInt(String(row[5])) || totalQty));
      const condRaw = String(row[7] || "good").toLowerCase().trim();
      const condition: "excellent" | "good" | "fair" | "needs_repair" =
        ["excellent", "good", "fair", "needs_repair"].includes(condRaw)
          ? (condRaw as "excellent" | "good" | "fair" | "needs_repair")
          : "good";

      if (!isSupabaseConfigured()) {
        if (process.env.NODE_ENV !== "production") {
          const { upsertDevEquipment } = await import("@/lib/dev-store");
          upsertDevEquipment({
            id: rawId || undefined,
            name,
            category,
            description,
            total_quantity: totalQty,
            available_quantity: availQty,
            condition,
          });
          importedCount++;
        }
      } else {
        const supabase = getSupabaseAdmin();
        if (rawId) {
          await supabase.from("equipment").upsert({
            id: rawId,
            name,
            category,
            description,
            total_quantity: totalQty,
            available_quantity: availQty,
            condition,
            updated_at: now,
          });
        } else {
          await supabase.from("equipment").insert({
            name,
            category,
            description,
            total_quantity: totalQty,
            available_quantity: availQty,
            condition,
          });
        }
        importedCount++;
      }
    }

    if (member && isSupabaseConfigured()) {
      const supabase = getSupabaseAdmin();
      await supabase.from("audit_log").insert({
        actor_member_id: member.id,
        action: "import_equipment_sheets",
        target_type: "equipment",
        target_id: sheetId || "default",
        metadata: { importedCount },
      });
    }

    return NextResponse.json({
      ok: true,
      direction: "pull",
      importedCount,
      message: `Successfully imported ${importedCount} equipment items from Google Sheets into the database.`,
    });
  }

  // =========================================================================
  // 2. DIRECTION: PUSH (Web App Database -> Google Sheets)
  // =========================================================================
  let equipmentItems: EquipmentRow[] = [];
  let requestItems: EquipmentRequestRow[] = [];

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      const { getDevEquipment, getDevEquipmentRequests } = await import("@/lib/dev-store");
      equipmentItems = getDevEquipment() as EquipmentRow[];
      requestItems = getDevEquipmentRequests(undefined, true) as unknown as EquipmentRequestRow[];
    } else {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }
  } else {
    const supabase = getSupabaseAdmin();
    const [eqRes, reqRes] = await Promise.all([
      supabase.from("equipment").select("*").order("name", { ascending: true }),
      supabase
        .from("equipment_requests")
        .select(`
          *,
          equipment:equipment_id(id, name),
          member:member_id(id, email, full_name, membership_tier)
        `)
        .order("created_at", { ascending: false }),
    ]);

    if (eqRes.error) {
      return NextResponse.json({ error: "Failed to fetch equipment for sync" }, { status: 500 });
    }
    if (reqRes.error) {
      return NextResponse.json({ error: "Failed to fetch requests for sync" }, { status: 500 });
    }

    equipmentItems = (eqRes.data || []) as EquipmentRow[];
    requestItems = (reqRes.data || []) as EquipmentRequestRow[];
  }

  const masterRows = buildEquipmentMasterRows(equipmentItems);
  const ledgerRows = buildEquipmentLedgerRows(requestItems);
  const dashboardRows = buildDashboardRows();

  let webhookDelivered = false;
  let deliveryNotice = "";

  const resolvedSheetId = cleanSheetId(sheetId);

  if (sheetWebhookUrl) {
    try {
      const response = await fetch(sheetWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        redirect: "follow",
        body: JSON.stringify({
          action: "push_to_sheet",
          sheetId: resolvedSheetId,
          equipmentMaster: masterRows,
          equipmentLedger: ledgerRows,
          dashboard: dashboardRows,
        }),
      });

      const resText = await response.text();
      let resJson: { status?: string; message?: string; error?: string } = {};
      try {
        resJson = JSON.parse(resText);
      } catch {
        // Response might be plain HTML or text
      }

      if (resJson.status === "error") {
        webhookDelivered = false;
        deliveryNotice = `Google Apps Script returned an error: ${resJson.message || "Unknown error"}`;
      } else if (response.ok) {
        webhookDelivered = true;
        deliveryNotice =
          resJson.message ||
          "Successfully updated Google Sheets! Master List, Ledger Log, and Dashboard formatted with UCL Hiking styling and formulas.";
      } else {
        webhookDelivered = false;
        deliveryNotice = `Webhook delivery responded with HTTP ${response.status}: ${resText.slice(0, 200)}`;
      }
    } catch (err: unknown) {
      deliveryNotice = `Webhook connection error: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    deliveryNotice =
      "Google Sheet webhook URL is not configured. Configure it in the Equipment Settings modal.";
  }

  if (member && isSupabaseConfigured()) {
    const supabase = getSupabaseAdmin();
    await supabase.from("audit_log").insert({
      actor_member_id: member.id,
      action: "sync_equipment_sheets",
      target_type: "equipment",
      target_id: resolvedSheetId || "default",
      metadata: {
        equipmentCount: equipmentItems.length,
        requestsCount: requestItems.length,
        webhookDelivered,
        deliveryNotice,
      },
    });
  }

  return NextResponse.json({
    ok: webhookDelivered,
    direction: "push",
    webhookDelivered,
    equipmentCount: equipmentItems.length,
    requestsCount: requestItems.length,
    message: deliveryNotice,
  });
}
