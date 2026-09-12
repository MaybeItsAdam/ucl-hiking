"""Cloud Run entry point: SU member/committee/event rosters -> Hiking web API & Google Sheets."""

from __future__ import annotations

import base64
import json
import os
import sys
from typing import Any

import httpx
from suu.retrieve.committee import fetch_committee
from suu.retrieve.members import fetch_members
from suu.retrieve.sales import fetch_sales

from .events import build_event_sync_rows
from .policy import RolePolicy, build_sync_rows, normalize_email
from .sheets import sync_to_google_sheet


def csv_set(name: str) -> frozenset[str]:
    return frozenset(
        normalize_email(value)
        for value in os.environ.get(name, "").split(",")
        if normalize_email(value)
    )


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def setup_suu_session_env() -> None:
    """Ensure SUU auth state env vars are populated if a raw SUU_SESSION_ID is provided."""
    session_id = os.environ.get("SUU_SESSION_ID", "").strip()
    if not session_id:
        return

    if os.environ.get("SUU_AUTH_STATE_BASE64") or os.environ.get("SUU_AUTH_STATE_JSON"):
        return

    if session_id.startswith("{") and session_id.endswith("}"):
        os.environ["SUU_AUTH_STATE_JSON"] = session_id
    elif len(session_id) > 100 and not any(sep in session_id for sep in (";", " ", "=")):
        os.environ["SUU_AUTH_STATE_BASE64"] = session_id
    else:
        cookies = []
        if "=" in session_id:
            for part in session_id.split(";"):
                part = part.strip()
                if "=" in part:
                    c_name, c_val = part.split("=", 1)
                    cookies.append({
                        "name": c_name.strip(),
                        "value": c_val.strip(),
                        "domain": "studentsunionucl.org",
                        "path": "/",
                        "httpOnly": True,
                        "secure": True,
                        "sameSite": "Lax",
                    })
        else:
            cookies = [
                {
                    "name": ".AspNet.Cookies",
                    "value": session_id,
                    "domain": "studentsunionucl.org",
                    "path": "/",
                    "httpOnly": True,
                    "secure": True,
                    "sameSite": "Lax",
                },
                {
                    "name": "ASP.NET_SessionId",
                    "value": session_id,
                    "domain": "studentsunionucl.org",
                    "path": "/",
                    "httpOnly": True,
                    "secure": True,
                    "sameSite": "Lax",
                },
                {
                    "name": "SSESS41428e140b4dc9b07f8c5c3e1fd73f96",
                    "value": session_id,
                    "domain": "studentsunionucl.org",
                    "path": "/",
                    "httpOnly": True,
                    "secure": True,
                    "sameSite": "Lax",
                },
            ]

        state = {
            "cookies": cookies,
            "origins": [],
        }
        os.environ["SUU_AUTH_STATE_JSON"] = json.dumps(state)


def report_session_expiration(web_url: str, sync_secret: str, error_msg: str) -> None:
    """Notify the web application when an expired session ID causes sync failure."""
    try:
        httpx.post(
            f"{web_url}/api/sync/session-status",
            headers={"x-member-sync-secret": sync_secret},
            json={"status": "expired", "error": error_msg},
            timeout=10,
        )
    except Exception as err:
        print(f"Failed to report session expiration to web API: {err}", file=sys.stderr)


def main() -> None:
    custom_group = None
    for i, arg in enumerate(sys.argv):
        if arg == "--group" and i + 1 < len(sys.argv):
            custom_group = sys.argv[i + 1]
        elif arg.startswith("--group="):
            custom_group = arg.split("=", 1)[1]

    group = (custom_group or os.environ.get("SUU_GROUP", "Hiking Club")).strip()
    source_name = f"suu-{group.lower().replace(' ', '-')}" if group.lower() != "hiking club" else "suu-cloud-run"
    web_url = required("HIKING_WEB_URL").rstrip("/")
    sync_secret = required("MEMBER_SYNC_SECRET")
    sheet_id = os.environ.get("GOOGLE_SHEET_ID", "")

    setup_suu_session_env()

    policy = RolePolicy(
        admin_emails=csv_set("ADMIN_EMAILS"),
        walk_leader_emails=csv_set("WALK_LEADER_EMAILS"),
        principal_role_keywords=tuple(
            value.strip().lower()
            for value in os.environ.get("PRINCIPAL_ROLE_KEYWORDS", "president,treasurer").split(",")
            if value.strip()
        ),
    )

    try:
        members = fetch_members(group, headless=True)
        committee = fetch_committee(group, headless=True)
    except Exception as error:
        error_text = str(error)
        if any(kw in error_text.lower() for kw in ("login", "access denied", "401", "403", "expired", "authenticated")):
            report_session_expiration(web_url, sync_secret, f"Member sync auth failed: {error_text}")
        raise RuntimeError(f"SUU member retrieval for '{group}' failed: {error_text}") from error

    member_rows = build_sync_rows(members, committee, policy)
    if not member_rows:
        raise RuntimeError(f"SUU returned no valid members for '{group}'; refusing an empty full snapshot")

    # Fetch event statuses using suu
    raw_sales: list[dict[str, Any]] = []
    try:
        raw_sales = fetch_sales(group, headless=True)
    except Exception as error:
        print(f"Event sales retrieval warning: {error}", file=sys.stderr)

    event_rows = build_event_sync_rows(raw_sales)

    # Post member snapshot to web API
    response = httpx.post(
        f"{web_url}/api/sync/members",
        headers={"x-member-sync-secret": sync_secret},
        json={"source": source_name, "fullSnapshot": True, "members": member_rows},
        timeout=30,
    )
    response.raise_for_status()

    # Post event snapshot to web API
    if event_rows:
        try:
            event_resp = httpx.post(
                f"{web_url}/api/sync/events",
                headers={"x-member-sync-secret": sync_secret},
                json={"source": source_name, "events": event_rows},
                timeout=30,
            )
            event_resp.raise_for_status()
        except Exception as err:
            print(f"Event sync web API warning: {err}", file=sys.stderr)

    # Seed/Update Google Sheet if sheet ID configured
    if sheet_id:
        equipment_rows: list[dict[str, Any]] = []
        request_rows: list[dict[str, Any]] = []
        try:
            eq_resp = httpx.get(
                f"{web_url}/api/equipment",
                headers={"x-member-sync-secret": sync_secret},
                timeout=15,
            )
            if eq_resp.is_success:
                equipment_rows = eq_resp.json().get("equipment", [])
        except Exception as err:
            print(f"Equipment fetch warning: {err}", file=sys.stderr)

        try:
            req_resp = httpx.get(
                f"{web_url}/api/equipment/requests",
                headers={"x-member-sync-secret": sync_secret},
                timeout=15,
            )
            if req_resp.is_success:
                request_rows = req_resp.json().get("requests", [])
        except Exception as err:
            print(f"Equipment requests fetch warning: {err}", file=sys.stderr)

        sync_to_google_sheet(
            sheet_id,
            members=member_rows,
            events=event_rows,
            equipment=equipment_rows,
            equipment_requests=request_rows,
        )

    # Report active session status
    try:
        httpx.post(
            f"{web_url}/api/sync/session-status",
            headers={"x-member-sync-secret": sync_secret},
            json={"status": "active", "error": None},
            timeout=10,
        )
    except Exception as err:
        print(f"Failed to update active session status: {err}", file=sys.stderr)

    result = {
        "ok": True,
        "membersSynced": len(member_rows),
        "eventsSynced": len(event_rows),
        "googleSheetUpdated": bool(sheet_id),
    }
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"member sync failed: {error}", file=sys.stderr)
        sys.exit(1)
