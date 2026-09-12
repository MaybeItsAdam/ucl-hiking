/**
 * UCL Hiking Club - Google Sheets Two-Way Inventory Sync & Brand Styling Engine
 * 
 * Enforces official UCL Hiking Club visual branding and spreadsheet architecture:
 * Palette:
 * - Ink:          #2f4355 (Primary Header / Charcoal Navy)
 * - Forest Teal:  #08a8ad (Signature Alpine Lake Teal Accent)
 * - Lime:         #b9da3b (Trail Lime Accent)
 * - Paper:        #f7f7f3 (Warm Topo Map Trail Paper)
 * - Mint:         #aaebe1 (Glacier Mint)
 * - Peach:        #f26640 (Terracotta Sunset Alert)
 * 
 * Sheets:
 * 1. "Dashboard"   - Live KPI metric cards, category formulas, and fleet telemetry
 * 2. "Master List" - Complete asset catalog with stock levels, dropdowns, and condition tags
 * 3. "Ledger Log"  - Chronological borrowing audit history, returns, and status tracking
 */

var BRAND = {
  INK:          "#2f4355",  // Primary UCL Hiking Dark Ink / Slate Navy
  DEEP:         "#2d4153",  // Mountain Slate
  FOREST_TEAL:  "#08a8ad",  // Signature UCL Hiking Teal
  LIME:         "#b9da3b",  // Trail Lime Accent
  PAPER:        "#f7f7f3",  // Warm Topo Trail Paper
  CREAM:        "#e8edef",  // Soft Mist / Stone
  PEACH:        "#f26640",  // Sunset Terracotta
  MINT:         "#aaebe1",  // Glacier Mint Highlight
  WHITE:        "#ffffff",
  BORDER:       "#dbe2e6",  // Clean subtle slate border
  
  // Status Colors (Matching web app .req-status)
  STATUS_APPROVED_BG: "#dcfce7",
  STATUS_APPROVED_FG: "#166534",
  STATUS_PENDING_BG:  "#fef9c3",
  STATUS_PENDING_FG:  "#854d0e",
  STATUS_RETURNED_BG: "#e0f2fe",
  STATUS_RETURNED_FG: "#0369a1",
  STATUS_REJECTED_BG: "#fee2e2",
  STATUS_REJECTED_FG: "#991b1b",
  STATUS_CANCEL_BG:   "#f1f5f9",
  STATUS_CANCEL_FG:   "#64748b",
  
  // Kit Condition Colors (Matching web app .condition-badge)
  COND_EXCELLENT_BG:  "#ccfbf1", // Glacier Mint
  COND_EXCELLENT_FG:  "#0f766e", // Deep Alpine Teal
  COND_GOOD_BG:       "#f0fdf4",
  COND_GOOD_FG:       "#15803d",
  COND_FAIR_BG:       "#fef9c3",
  COND_FAIR_FG:       "#854d0e",
  COND_REPAIR_BG:     "#ffedd5", // Terracotta Peach Alert
  COND_REPAIR_FG:     "#c2410c"
};

var FONT_FAMILY = "Arial";

/**
 * Creates custom UCL Hiking menu in Google Sheets toolbar on document open.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("🌲 UCL Hiking")
    .addItem("🎨 Apply Club Brand Styling & Formulas", "applyAllClubStyling")
    .addItem("⬆️ Push Changes to Web App", "pushSheetToWebApp")
    .addSeparator()
    .addItem("⚙️ Configure Web App URL", "configureWebAppUrl")
    .addToUi();
}

/**
 * Safely resolves the target Google Spreadsheet object.
 */
function getTargetSpreadsheet(sheetId) {
  var ss = null;

  if (sheetId) {
    var cleanId = String(sheetId).trim();
    var match = cleanId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      cleanId = match[1];
    }
    try {
      ss = SpreadsheetApp.openById(cleanId);
      if (ss) return ss;
    } catch (e) {
      Logger.log("openById failed: " + e);
    }
  }

  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss;
  } catch (e) {}

  try {
    var propId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID") ||
                 PropertiesService.getDocumentProperties().getProperty("SPREADSHEET_ID");
    if (propId) {
      ss = SpreadsheetApp.openById(propId);
      if (ss) return ss;
    }
  } catch (e) {}

  return null;
}

/**
 * Handle incoming GET requests from Next.js web portal (Two-Way Pull).
 */
function doGet(e) {
  try {
    var sheetId = (e && e.parameter && e.parameter.sheetId) ? e.parameter.sheetId : null;
    var ss = getTargetSpreadsheet(sheetId);

    if (!ss) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "error",
        message: "No spreadsheet found. Pass ?sheetId=YOUR_SPREADSHEET_ID or bind script directly."
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var masterSheet = ss.getSheetByName("Master List");
    var ledgerSheet = ss.getSheetByName("Ledger Log");

    var equipmentMaster = [];
    if (masterSheet && masterSheet.getLastRow() >= 1) {
      equipmentMaster = masterSheet.getRange(1, 1, masterSheet.getLastRow(), masterSheet.getLastColumn()).getValues();
    }

    var equipmentLedger = [];
    if (ledgerSheet && ledgerSheet.getLastRow() >= 1) {
      equipmentLedger = ledgerSheet.getRange(1, 1, ledgerSheet.getLastRow(), ledgerSheet.getLastColumn()).getValues();
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      equipmentMaster: equipmentMaster,
      equipmentLedger: equipmentLedger,
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handle incoming POST requests from Web App.
 * Writes data, formats worksheets, applies validations, and enforces brand styles.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(
        JSON.stringify({ status: "error", message: "No POST body data received" })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    var payload = JSON.parse(e.postData.contents);
    var ss = getTargetSpreadsheet(payload.sheetId);

    if (!ss) {
      return ContentService.createTextOutput(
        JSON.stringify({
          status: "error",
          message: "Unable to find Google Spreadsheet. Please provide Google Spreadsheet ID or bind script to sheet."
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    var results = {};

    // 1. Update Master List tab & enforce styling
    if (payload.equipmentMaster && Array.isArray(payload.equipmentMaster)) {
      results.masterList = updateSheet(
        ss,
        "Master List",
        payload.equipmentMaster,
        BRAND.INK,
        true
      );
      applyMasterListStyling(ss.getSheetByName("Master List"));
    }

    // 2. Update Ledger Log tab & enforce styling
    if (payload.equipmentLedger && Array.isArray(payload.equipmentLedger)) {
      results.ledgerLog = updateSheet(
        ss,
        "Ledger Log",
        payload.equipmentLedger,
        BRAND.INK,
        true
      );
      applyLedgerStyling(ss.getSheetByName("Ledger Log"));
    }

    // 3. Update Dashboard tab with styled KPI cards & live formulas
    if (payload.dashboard && Array.isArray(payload.dashboard)) {
      results.dashboard = updateDashboard(ss, payload.dashboard);
    } else {
      results.dashboard = ensureDefaultDashboard(ss);
    }

    // Move Dashboard tab to position 1, Master List to position 2
    try {
      var dash = ss.getSheetByName("Dashboard");
      if (dash) ss.setActiveSheet(dash);
    } catch (e) {}

    return ContentService.createTextOutput(
      JSON.stringify({
        status: "success",
        message: "Successfully styled with UCL Hiking Club brand (Teal & Ink), dropdowns, and formulas.",
        updated: results
      })
    ).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: "error", message: "Error applying styling: " + err.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Replaces sheet data with rows array, freezes header, and applies UCL brand styling.
 */
function updateSheet(ss, sheetName, rows, headerColor, freezeHeader) {
  if (!rows || rows.length === 0) return 0;

  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  sheet.clear();
  try {
    sheet.clearConditionalFormatRules();
  } catch (e) {}

  var numRows = rows.length;
  var numCols = rows[0].length;

  var range = sheet.getRange(1, 1, numRows, numCols);
  range.setValues(rows);

  // Style Header Row (UCL Ink Background with White Text & 38px Height)
  var headerRange = sheet.getRange(1, 1, 1, numCols);
  headerRange.setBackground(headerColor || BRAND.INK);
  headerRange.setFontColor(BRAND.WHITE);
  headerRange.setFontWeight("bold");
  try {
    headerRange.setFontFamily(FONT_FAMILY);
  } catch (e) {}
  headerRange.setFontSize(10);
  headerRange.setVerticalAlignment("middle");
  sheet.setRowHeight(1, 38);

  // Set subtle Teal accent border under header
  try {
    headerRange.setBorder(null, null, true, null, null, null, BRAND.FOREST_TEAL, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  } catch (e) {}

  // Set data rows formatting
  if (numRows > 1) {
    var dataRange = sheet.getRange(2, 1, numRows - 1, numCols);
    try {
      dataRange.setFontFamily(FONT_FAMILY);
    } catch (e) {}
    dataRange.setFontSize(10);
    dataRange.setVerticalAlignment("middle");
    
    // Set clean cell borders matching webapp --line
    try {
      dataRange.setBorder(true, true, true, true, true, true, BRAND.BORDER, SpreadsheetApp.BorderStyle.SOLID);
    } catch (e) {}

    // Comfortable touch row heights
    for (var r = 2; r <= Math.min(numRows, 150); r++) {
      sheet.setRowHeight(r, 28);
    }

    // Apply Alternating Row Colors (Warm paper and white)
    for (var r = 2; r <= numRows; r++) {
      var rowColor = (r % 2 === 0) ? BRAND.WHITE : BRAND.PAPER;
      sheet.getRange(r, 1, 1, numCols).setBackground(rowColor);
    }
  }

  if (freezeHeader) {
    sheet.setFrozenRows(1);
  }

  return numRows - 1;
}

/**
 * Enforce styling, dropdown validation, and conditional formatting on Master List.
 */
function applyMasterListStyling(sheet) {
  if (!sheet) return;
  var lastRow = Math.max(2, sheet.getLastRow());

  // Set column alignments
  try {
    sheet.getRange(2, 1, lastRow - 1, 1).setHorizontalAlignment("center").setFontColor("#64748b"); // ID
    sheet.getRange(2, 2, lastRow - 1, 1).setHorizontalAlignment("left").setFontWeight("bold").setFontColor(BRAND.INK); // Item Name
    sheet.getRange(2, 3, lastRow - 1, 1).setHorizontalAlignment("center"); // Category
    sheet.getRange(2, 4, lastRow - 1, 1).setHorizontalAlignment("left").setWrap(true); // Description
    sheet.getRange(2, 5, lastRow - 1, 3).setHorizontalAlignment("center"); // Quantities (Total, Avail, Loan)
    sheet.getRange(2, 8, lastRow - 1, 1).setHorizontalAlignment("center"); // Condition
    sheet.getRange(2, 9, lastRow - 1, 1).setHorizontalAlignment("center").setFontColor("#64748b"); // Last Updated

    // Format quantities as whole numbers
    sheet.getRange(2, 5, lastRow - 1, 3).setNumberFormat("#,##0");
    sheet.getRange(2, 6, lastRow - 1, 1).setFontWeight("bold"); // Available quantity bold
  } catch (e) {}

  // Adjust column widths for optimal reading
  try {
    sheet.setColumnWidth(1, 130); // ID
    sheet.setColumnWidth(2, 260); // Name
    sheet.setColumnWidth(3, 160); // Category
    sheet.setColumnWidth(4, 320); // Description
    sheet.setColumnWidth(5, 110); // Total
    sheet.setColumnWidth(6, 110); // Available
    sheet.setColumnWidth(7, 110); // On Loan
    sheet.setColumnWidth(8, 140); // Condition
    sheet.setColumnWidth(9, 160); // Last Updated
  } catch (e) {}

  // 1. Data Validation: Category Dropdown (Column C)
  try {
    var categoryRule = SpreadsheetApp.newDataValidation()
      .requireValueInList([
        "Tents & Shelter",
        "Footwear & Boots",
        "Rucksacks & Bags",
        "Navigation & Safety",
        "Cooking & Stoves",
        "Sleeping Gear",
        "General & Other"
      ], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, 3, lastRow - 1, 1).setDataValidation(categoryRule);
  } catch (e) {}

  // 2. Data Validation: Condition Dropdown (Column H)
  try {
    var conditionRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(["excellent", "good", "fair", "needs_repair"], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, 8, lastRow - 1, 1).setDataValidation(conditionRule);
  } catch (e) {}

  // 3. Conditional Formatting Rules (UCL Brand Palette)
  var rules = [];
  var condRange = sheet.getRange(2, 8, lastRow - 1, 1);
  var availRange = sheet.getRange(2, 6, lastRow - 1, 1);

  // Condition: excellent -> Glacier Mint (#ccfbf1) & Deep Alpine Teal (#0f766e)
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("excellent")
      .setBackground(BRAND.COND_EXCELLENT_BG)
      .setFontColor(BRAND.COND_EXCELLENT_FG)
      .setBold(true)
      .setRanges([condRange])
      .build()
  );

  // Condition: good -> Soft Green (#f0fdf4) & Trail Forest (#15803d)
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("good")
      .setBackground(BRAND.COND_GOOD_BG)
      .setFontColor(BRAND.COND_GOOD_FG)
      .setRanges([condRange])
      .build()
  );

  // Condition: fair -> Warm Trail Amber (#fef9c3) & (#854d0e)
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("fair")
      .setBackground(BRAND.COND_FAIR_BG)
      .setFontColor(BRAND.COND_FAIR_FG)
      .setRanges([condRange])
      .build()
  );

  // Condition: needs_repair -> Terracotta Peach Alert (#ffedd5) & (#c2410c)
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("needs_repair")
      .setBackground(BRAND.COND_REPAIR_BG)
      .setFontColor(BRAND.COND_REPAIR_FG)
      .setBold(true)
      .setRanges([condRange])
      .build()
  );

  // Stock: Available == 0 -> Alert Red
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberEqualTo(0)
      .setBackground(BRAND.STATUS_REJECTED_BG)
      .setFontColor(BRAND.STATUS_REJECTED_FG)
      .setBold(true)
      .setRanges([availRange])
      .build()
  );

  try {
    sheet.setConditionalFormatRules(rules);
  } catch (e) {}
}

/**
 * Enforce styling, dropdown validation, and conditional formatting on Ledger Log.
 */
function applyLedgerStyling(sheet) {
  if (!sheet) return;
  var lastRow = Math.max(2, sheet.getLastRow());

  // Set alignments
  try {
    sheet.getRange(2, 1, lastRow - 1, 1).setHorizontalAlignment("center").setFontColor("#64748b");  // ID
    sheet.getRange(2, 2, lastRow - 1, 1).setHorizontalAlignment("center").setFontColor("#64748b");  // Date
    sheet.getRange(2, 3, lastRow - 1, 2).setHorizontalAlignment("left");    // Name, Email
    sheet.getRange(2, 5, lastRow - 1, 1).setHorizontalAlignment("center");  // Tier
    sheet.getRange(2, 6, lastRow - 1, 1).setHorizontalAlignment("left").setFontWeight("bold").setFontColor(BRAND.INK); // Item
    sheet.getRange(2, 7, lastRow - 1, 1).setHorizontalAlignment("center");  // Qty
    sheet.getRange(2, 8, lastRow - 1, 2).setHorizontalAlignment("center");  // Start/End
    sheet.getRange(2, 10, lastRow - 1, 1).setHorizontalAlignment("left").setWrap(true); // Purpose
    sheet.getRange(2, 11, lastRow - 1, 1).setHorizontalAlignment("center"); // Status
    sheet.getRange(2, 12, lastRow - 1, 2).setHorizontalAlignment("left");   // Reviewer & Notes
  } catch (e) {}

  // Adjust column widths
  try {
    sheet.setColumnWidth(1, 130);
    sheet.setColumnWidth(2, 170);
    sheet.setColumnWidth(3, 180);
    sheet.setColumnWidth(4, 210);
    sheet.setColumnWidth(5, 120);
    sheet.setColumnWidth(6, 240);
    sheet.setColumnWidth(7, 90);
    sheet.setColumnWidth(8, 110);
    sheet.setColumnWidth(9, 110);
    sheet.setColumnWidth(10, 260);
    sheet.setColumnWidth(11, 130);
    sheet.setColumnWidth(12, 160);
    sheet.setColumnWidth(13, 220);
  } catch (e) {}

  // Status Validation Dropdown (Column K)
  try {
    var statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(["pending", "approved", "returned", "rejected", "cancelled"], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, 11, lastRow - 1, 1).setDataValidation(statusRule);
  } catch (e) {}

  // Status Conditional Formatting (Matching Web App .req-status)
  var rules = [];
  var statusRange = sheet.getRange(2, 11, lastRow - 1, 1);

  // Approved -> Green
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("approved")
      .setBackground(BRAND.STATUS_APPROVED_BG)
      .setFontColor(BRAND.STATUS_APPROVED_FG)
      .setBold(true)
      .setRanges([statusRange])
      .build()
  );

  // Pending -> Warm Amber
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("pending")
      .setBackground(BRAND.STATUS_PENDING_BG)
      .setFontColor(BRAND.STATUS_PENDING_FG)
      .setBold(true)
      .setRanges([statusRange])
      .build()
  );

  // Returned -> Soft Blue
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("returned")
      .setBackground(BRAND.STATUS_RETURNED_BG)
      .setFontColor(BRAND.STATUS_RETURNED_FG)
      .setBold(true)
      .setRanges([statusRange])
      .build()
  );

  // Rejected -> Terracotta Sunset Alert
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("rejected")
      .setBackground(BRAND.STATUS_REJECTED_BG)
      .setFontColor(BRAND.STATUS_REJECTED_FG)
      .setBold(true)
      .setRanges([statusRange])
      .build()
  );

  // Cancelled -> Neutral Slate Gray
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("cancelled")
      .setBackground(BRAND.STATUS_CANCEL_BG)
      .setFontColor(BRAND.STATUS_CANCEL_FG)
      .setRanges([statusRange])
      .build()
  );

  try {
    sheet.setConditionalFormatRules(rules);
  } catch (e) {}
}

/**
 * Update and style the Dashboard worksheet with executive KPI cards and category summaries.
 */
function updateDashboard(ss, rows) {
  var sheet = ss.getSheetByName("Dashboard");
  if (!sheet) {
    sheet = ss.insertSheet("Dashboard", 0);
  }

  sheet.clear();
  try {
    sheet.clearConditionalFormatRules();
  } catch (e) {}

  var numRows = rows.length;
  var numCols = 3;

  var range = sheet.getRange(1, 1, numRows, numCols);
  range.setValues(rows);

  try {
    range.setFontFamily(FONT_FAMILY);
  } catch (e) {}

  // 1. Title Banner (Row 1) - UCL Ink Navy
  var titleRange = sheet.getRange(1, 1, 1, 3);
  try {
    titleRange.merge();
  } catch (e) {}
  titleRange.setBackground(BRAND.INK);
  titleRange.setFontColor(BRAND.WHITE);
  titleRange.setFontWeight("bold");
  titleRange.setFontSize(13);
  titleRange.setVerticalAlignment("middle");
  sheet.setRowHeight(1, 44);

  // 2. Subtitle Bar (Row 2) - Alpine Lake Teal Accent
  var subRange = sheet.getRange(2, 1, 1, 3);
  try {
    subRange.merge();
  } catch (e) {}
  subRange.setBackground(BRAND.FOREST_TEAL);
  subRange.setFontColor(BRAND.WHITE);
  subRange.setFontSize(10);
  subRange.setFontWeight("bold");
  subRange.setVerticalAlignment("middle");
  sheet.setRowHeight(2, 26);

  // 3. Section Header 1: Metrics Summary (Row 3)
  var s1 = sheet.getRange(3, 1, 1, 3);
  s1.setBackground(BRAND.INK);
  s1.setFontColor(BRAND.MINT);
  s1.setFontWeight("bold");
  s1.setFontSize(10);
  sheet.setRowHeight(3, 30);

  // Style Metric Values (Rows 4-10, Column B)
  var metricVals = sheet.getRange(4, 2, 7, 1);
  metricVals.setFontWeight("bold");
  metricVals.setFontSize(12);
  metricVals.setHorizontalAlignment("center");
  metricVals.setBackground("#f0fdfa"); // Light teal tint
  metricVals.setFontColor(BRAND.INK);

  // Metrics Table Borders & Alternating Background
  for (var r = 4; r <= 10; r++) {
    sheet.setRowHeight(r, 26);
    if (r % 2 === 1) {
      sheet.getRange(r, 1, 1, 1).setBackground(BRAND.PAPER);
      sheet.getRange(r, 3, 1, 1).setBackground(BRAND.PAPER);
    }
  }
  try {
    sheet.getRange(3, 1, 8, 3).setBorder(true, true, true, true, true, true, BRAND.BORDER, SpreadsheetApp.BorderStyle.SOLID);
  } catch (e) {}

  // 4. Section Header 2: Category Breakdown (Row 12)
  var s2 = sheet.getRange(12, 1, 1, 3);
  s2.setBackground(BRAND.INK);
  s2.setFontColor(BRAND.LIME); // Trail Lime
  s2.setFontWeight("bold");
  s2.setFontSize(10);
  sheet.setRowHeight(12, 30);

  // Style Category values (Rows 13-19)
  var catVals = sheet.getRange(13, 2, 7, 2);
  catVals.setHorizontalAlignment("center");
  catVals.setFontWeight("bold");

  for (var r = 13; r <= 19; r++) {
    sheet.setRowHeight(r, 26);
    var rowBg = (r % 2 === 0) ? BRAND.WHITE : BRAND.PAPER;
    sheet.getRange(r, 1, 1, 3).setBackground(rowBg);
  }

  try {
    sheet.getRange(12, 1, 8, 3).setBorder(true, true, true, true, true, true, BRAND.BORDER, SpreadsheetApp.BorderStyle.SOLID);
  } catch (e) {}

  // Set column widths
  sheet.setColumnWidth(1, 280);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(3, 340);

  return numRows;
}

/**
 * Creates default dashboard if none provided in payload.
 */
function ensureDefaultDashboard(ss) {
  var defaultRows = [
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
    ["General & Other", '=COUNTIF(\'Master List\'!C2:C, "General & Other")', '=SUMIF(\'Master List\'!C2:C, "General & Other", \'Master List\'!E2:E)']
  ];
  return updateDashboard(ss, defaultRows);
}

/**
 * Menu Action: Apply all styling across the workbook manually from Google Sheets UI.
 */
function applyAllClubStyling() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    SpreadsheetApp.getUi().alert("No active spreadsheet found.");
    return;
  }

  var master = ss.getSheetByName("Master List");
  var ledger = ss.getSheetByName("Ledger Log");
  
  if (master) applyMasterListStyling(master);
  if (ledger) applyLedgerStyling(ledger);
  ensureDefaultDashboard(ss);

  SpreadsheetApp.getUi().alert("✅ UCL Hiking Club brand styling (Ink Navy & Alpine Teal), dropdown validations, and Dashboard formulas applied successfully!");
}

/**
 * Menu Action: Configure Web App URL in Document Properties.
 */
function configureWebAppUrl() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getDocumentProperties();
  var currentUrl = props.getProperty("WEB_APP_URL") || "http://localhost:3000";

  var response = ui.prompt(
    "Configure Web App URL",
    "Enter the URL of your UCL Hiking web app (e.g. https://your-domain.com or http://localhost:3000):",
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() === ui.Button.OK) {
    var url = response.getResponseText().trim().replace(/\/+$/, "");
    if (url) {
      props.setProperty("WEB_APP_URL", url);
      ui.alert("Web App URL saved: " + url);
    }
  }
}

/**
 * Menu Action: Push changes made in Google Sheets directly back to the Web App database.
 */
function pushSheetToWebApp() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var masterSheet = ss.getSheetByName("Master List");

  if (!masterSheet) {
    ui.alert("Could not find 'Master List' tab.");
    return;
  }

  var props = PropertiesService.getDocumentProperties();
  var webAppUrl = props.getProperty("WEB_APP_URL") || "http://localhost:3000";

  var rows = masterSheet.getRange(1, 1, masterSheet.getLastRow(), masterSheet.getLastColumn()).getValues();

  try {
    var response = UrlFetchApp.fetch(webAppUrl + "/api/equipment/sync-sheets", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        direction: "pull",
        sheetRows: rows
      }),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var resultText = response.getContentText();

    if (code >= 200 && code < 300) {
      var json = JSON.parse(resultText);
      ui.alert("✅ Synced with Web App!\n\n" + (json.message || "Equipment items successfully imported into website database."));
    } else {
      ui.alert("Sync Error (HTTP " + code + "):\n\n" + resultText);
    }
  } catch (err) {
    ui.alert("Failed to connect to web app at " + webAppUrl + ":\n\n" + err.toString() + "\n\nUse 'Configure Web App URL' in the UCL Hiking menu to set the correct URL.");
  }
}
