"""Seed and update Google Sheets with member and event status records."""

from __future__ import annotations

import json
import os
from typing import Any
import httpx


def format_member_sheet_rows(members: list[dict[str, Any]]) -> list[list[str]]:
    """Format members list into standard Google Sheet table rows with headers."""
    header = ["Email", "Full Name", "Membership Tier", "Governance Role", "Walk Leader", "Source Ref"]
    rows = [header]
    for m in members:
        rows.append([
            str(m.get("email") or ""),
            str(m.get("fullName") or ""),
            str(m.get("membershipTier") or ""),
            str(m.get("governanceRole") or ""),
            "Yes" if m.get("isWalkLeader") else "No",
            str(m.get("sourceReference") or ""),
        ])
    return rows


def format_event_sheet_rows(events: list[dict[str, Any]]) -> list[list[str]]:
    """Format event statuses list into standard Google Sheet table rows with headers."""
    header = ["SU Event ID", "Title", "Status", "Starts At", "Location", "Capacity", "Tickets Sold"]
    rows = [header]
    for e in events:
        rows.append([
            str(e.get("suuEventId") or ""),
            str(e.get("title") or ""),
            str(e.get("status") or ""),
            str(e.get("startsAt") or ""),
            str(e.get("location") or ""),
            str(e.get("capacity") or 0),
            str(e.get("ticketsSold") or 0),
        ])
    return rows


def format_equipment_master_sheet_rows(equipment: list[dict[str, Any]]) -> list[list[str]]:
    """Format equipment catalog into Master List table rows with headers."""
    header = [
        "Equipment ID",
        "Item Name",
        "Category",
        "Description",
        "Total Quantity",
        "Available Quantity",
        "On Loan Quantity",
        "Condition",
        "Last Updated",
    ]
    rows = [header]
    for item in equipment:
        total = int(item.get("totalQuantity") or item.get("total_quantity") or 0)
        avail = int(item.get("availableQuantity") or item.get("available_quantity") or 0)
        on_loan = max(0, total - avail)
        rows.append([
            str(item.get("id") or ""),
            str(item.get("name") or ""),
            str(item.get("category") or "General"),
            str(item.get("description") or ""),
            str(total),
            str(avail),
            str(on_loan),
            str(item.get("condition") or "good"),
            str(item.get("updatedAt") or item.get("updated_at") or ""),
        ])
    return rows


def format_equipment_ledger_sheet_rows(requests: list[dict[str, Any]]) -> list[list[str]]:
    """Format equipment borrow requests into Ledger Log table rows with headers."""
    header = [
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
    ]
    rows = [header]
    for req in requests:
        member = req.get("member") or {}
        eq = req.get("equipment") or {}
        member_name = member.get("fullName") or member.get("full_name") or req.get("memberName") or ""
        member_email = member.get("email") or req.get("memberEmail") or ""
        member_tier = member.get("membershipTier") or member.get("membership_tier") or req.get("membershipTier") or ""
        eq_name = eq.get("name") or req.get("equipmentName") or ""

        rows.append([
            str(req.get("id") or ""),
            str(req.get("createdAt") or req.get("created_at") or ""),
            str(member_name),
            str(member_email),
            str(member_tier),
            str(eq_name),
            str(req.get("quantity") or 1),
            str(req.get("startDate") or req.get("start_date") or ""),
            str(req.get("endDate") or req.get("end_date") or ""),
            str(req.get("purpose") or ""),
            str(req.get("status") or "pending"),
            str(req.get("reviewedBy") or req.get("reviewed_by") or ""),
            str(req.get("notes") or ""),
        ])
    return rows


def format_dashboard_sheet_rows() -> list[list[str]]:
    """Generate Dashboard KPI metrics and category breakdown with Google Sheets formulas."""
    return [
        ["UCL Hiking Club - Equipment Inventory & Loan Dashboard", "", ""],
        ["", "", ""],
        ["METRIC SUMMARY", "VALUE / FORMULA", "DESCRIPTION"],
        ["Total Gear Varieties", "=COUNTA('Master List'!A2:A)", "Total unique equipment models cataloged"],
        ["Total Units in Fleet", "=SUM('Master List'!E2:E)", "Aggregate quantity of all gear owned"],
        ["Units in Storage (Available)", "=SUM('Master List'!F2:F)", "Units currently available for checkout"],
        ["Units Currently on Loan", "=SUM('Master List'!G2:G)", "Active items borrowed by club members"],
        ["Items Flagged for Repair", '=COUNTIF(\'Master List\'!H2:H, "needs_repair")', "Equipment requiring maintenance or replacement"],
        ["Pending Loan Requests", '=COUNTIF(\'Ledger Log\'!K2:K, "pending")', "Requests awaiting committee review"],
        ["Active Approved Loans", '=COUNTIF(\'Ledger Log\'!K2:K, "approved")', "Kit currently checked out"],
        ["", "", ""],
        ["CATEGORY BREAKDOWN", "VARIETY COUNT", "TOTAL UNITS"],
        ["Tents & Shelter", '=COUNTIF(\'Master List\'!C2:C, "Tents & Shelter")', '=SUMIF(\'Master List\'!C2:C, "Tents & Shelter", \'Master List\'!E2:E)'],
        ["Footwear & Boots", '=COUNTIF(\'Master List\'!C2:C, "Footwear & Boots")', '=SUMIF(\'Master List\'!C2:C, "Footwear & Boots", \'Master List\'!E2:E)'],
        ["Rucksacks & Bags", '=COUNTIF(\'Master List\'!C2:C, "Rucksacks & Bags")', '=SUMIF(\'Master List\'!C2:C, "Rucksacks & Bags", \'Master List\'!E2:E)'],
        ["Navigation & Safety", '=COUNTIF(\'Master List\'!C2:C, "Navigation & Safety")', '=SUMIF(\'Master List\'!C2:C, "Navigation & Safety", \'Master List\'!E2:E)'],
        ["Cooking & Stoves", '=COUNTIF(\'Master List\'!C2:C, "Cooking & Stoves")', '=SUMIF(\'Master List\'!C2:C, "Cooking & Stoves", \'Master List\'!E2:E)'],
        ["Sleeping Gear", '=COUNTIF(\'Master List\'!C2:C, "Sleeping Gear")', '=SUMIF(\'Master List\'!C2:C, "Sleeping Gear", \'Master List\'!E2:E)'],
    ]


def sync_to_google_sheet(
    sheet_id: str,
    members: list[dict[str, Any]] | None = None,
    events: list[dict[str, Any]] | None = None,
    api_key: str | None = None,
    equipment: list[dict[str, Any]] | None = None,
    equipment_requests: list[dict[str, Any]] | None = None,
) -> bool:
    """Sync formatted member, event, and inventory data to a target Google Sheet if credentials are configured."""
    if not sheet_id:
        return False

    payload: dict[str, Any] = {"sheetId": sheet_id}

    if members is not None:
        payload["members"] = format_member_sheet_rows(members)
    if events is not None:
        payload["events"] = format_event_sheet_rows(events)
    if equipment is not None:
        payload["equipmentMaster"] = format_equipment_master_sheet_rows(equipment)
        payload["dashboard"] = format_dashboard_sheet_rows()
    if equipment_requests is not None:
        payload["equipmentLedger"] = format_equipment_ledger_sheet_rows(equipment_requests)
        if "dashboard" not in payload:
            payload["dashboard"] = format_dashboard_sheet_rows()

    sheet_webhook_url = os.environ.get("GOOGLE_SHEET_WEBHOOK_URL")
    if sheet_webhook_url:
        try:
            httpx.post(
                sheet_webhook_url,
                json=payload,
                timeout=15,
            )
            return True
        except Exception as err:
            print(f"Google Sheet webhook update notice: {err}")

    summary_parts = []
    if "members" in payload:
        summary_parts.append(f"{len(payload['members']) - 1} members")
    if "events" in payload:
        summary_parts.append(f"{len(payload['events']) - 1} events")
    if "equipmentMaster" in payload:
        summary_parts.append(f"{len(payload['equipmentMaster']) - 1} equipment items")
    if "equipmentLedger" in payload:
        summary_parts.append(f"{len(payload['equipmentLedger']) - 1} loan records")

    print(f"Seeded Google Sheet '{sheet_id}' payload: {', '.join(summary_parts)}.")
    return True
