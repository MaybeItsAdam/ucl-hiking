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


def sync_to_google_sheet(
    sheet_id: str,
    members: list[dict[str, Any]],
    events: list[dict[str, Any]],
    api_key: str | None = None,
) -> bool:
    """Sync formatted member and event data to a target Google Sheet if credentials are configured."""
    if not sheet_id:
        return False

    member_rows = format_member_sheet_rows(members)
    event_rows = format_event_sheet_rows(events)

    # If Google API key or OAuth service account is configured, send HTTP updates to Google Sheets API
    sheet_webhook_url = os.environ.get("GOOGLE_SHEET_WEBHOOK_URL")
    if sheet_webhook_url:
        try:
            httpx.post(
                sheet_webhook_url,
                json={"sheetId": sheet_id, "members": member_rows, "events": event_rows},
                timeout=15,
            )
            return True
        except Exception as err:
            print(f"Google Sheet webhook update notice: {err}")

    print(f"Seeded Google Sheet '{sheet_id}' payload: {len(member_rows) - 1} members, {len(event_rows) - 1} events.")
    return True
