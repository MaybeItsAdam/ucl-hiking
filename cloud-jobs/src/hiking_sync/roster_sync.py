"""TEMPORARY Cloud Run job: the SU members roster -> the hiking site, daily.

Stands in until the Toolbox Connector and its members API replace it (plan:
adams-campus-toolbox docs/plans/connector-rollout-plan.md). Plain HTTP with the stored SU
session, no browser: reads every page of /clubs-societies/<slug>/members and posts
the roster to /api/sync/roster, which stores it by name (the SU page has no emails).
"""

from __future__ import annotations

import html
import json
import os
import re
import sys
from datetime import datetime, time, timezone
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx

from .suu_session import SUU_BASE_URL, cookie_header, load_storage_state

USER_AGENT = "Mozilla/5.0 (compatible; ucl-hiking-roster-sync/1.0)"
MAX_PAGES = 100
LONDON = ZoneInfo("Europe/London")

# Cells are found by column class, never position; the over-18 column is never read.
COLUMNS = {
    "views-field-field-full-name": "fullName",
    "views-field-roles-target-id": "memberType",
    "views-field-field-membership-type": "membershipType",
    "views-field-date-range__value": "dateRange",
}
TBODY = re.compile(r"<tbody[^>]*>(.*?)</tbody>", re.S | re.I)
ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
CELL = re.compile(r"<td\b([^>]*)>(.*?)</td>", re.S | re.I)
CLASS = re.compile(r'class\s*=\s*"([^"]*)"', re.I)
TIME = re.compile(r"<time\b([^>]*)>(.*?)</time>", re.S | re.I)
DATETIME_ATTR = re.compile(r'datetime\s*=\s*"([^"]+)"', re.I)
UK_DATE = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")


class SyncError(RuntimeError):
    pass


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", " ", fragment))).strip()


def membership_end(date_range_html: str) -> str | None:
    """The membership's end as UTC ISO-8601, from the second <time> in the date-range cell.

    Prefers the machine-readable `datetime` attribute; some rows omit it, and then the
    dd/mm/yyyy text is read as the end of that day in London.
    """
    times = TIME.findall(date_range_html)
    if len(times) < 2:
        return None
    attrs, label = times[1]
    attr = DATETIME_ATTR.search(attrs)
    if attr:
        try:
            return datetime.fromisoformat(attr.group(1).replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
        except ValueError:
            pass
    match = UK_DATE.match(_text(label))
    if not match:
        return None
    day, month, year = (int(part) for part in match.groups())
    end = datetime.combine(datetime(year, month, day).date(), time(23, 59, 59), LONDON)
    return end.astimezone(timezone.utc).isoformat()


def parse_members_page(page_html: str) -> tuple[list[dict[str, Any]], bool, bool]:
    """Returns (members, has_next_page, recognised_as_members_table)."""
    recognised = bool(re.search(r"\bviews-view-table\b", page_html)) or "views-field-field-full-name" in page_html
    members: list[dict[str, Any]] = []
    tbody = TBODY.search(page_html)
    for row in ROW.findall(tbody.group(1) if tbody else ""):
        member: dict[str, Any] = {"fullName": "", "memberType": None, "membershipType": None, "membershipExpiresAt": None}
        for attrs, content in CELL.findall(row):
            class_attr = CLASS.search(attrs)
            classes = class_attr.group(1).split() if class_attr else []
            column = next((COLUMNS[name] for name in classes if name in COLUMNS), None)
            if column == "dateRange":
                member["membershipExpiresAt"] = membership_end(content)
            elif column:
                member[column] = _text(content) or None
        if member["fullName"]:
            members.append(member)
    has_next = bool(re.search(r'class="[^"]*\bpager__item--next\b', page_html))
    return members, has_next, recognised


def fetch_roster(client: httpx.Client, slug: str, cookies: str) -> list[dict[str, Any]]:
    members: list[dict[str, Any]] = []
    for page in range(MAX_PAGES):
        response = client.get(
            f"{SUU_BASE_URL}/clubs-societies/{slug}/members",
            params={"page": page},
            headers={"cookie": cookies, "user-agent": USER_AGENT},
        )
        if urlparse(str(response.url)).path.startswith("/user/login"):
            raise SyncError("expired: the SU site redirected to the login page")
        if response.status_code != 200:
            raise SyncError(f"the SU members page answered HTTP {response.status_code}")
        rows, has_next, recognised = parse_members_page(response.text)
        if not recognised:
            raise SyncError("the SU members page was not recognised as a members table")
        members.extend(rows)
        if not has_next or not rows:
            return members
    raise SyncError(f"the members list has more than {MAX_PAGES} pages")


SESSION_ENV = ("SUU_SESSION_ID", "SUU_AUTH_STATE_BASE64", "SUU_AUTH_STATE_JSON")


def use_site_session(client: httpx.Client, web_url: str, sync_secret: str) -> str:
    """Prefer the SU login a principal saved in the portal; fall back to the job's secret.

    The portal is where the login gets replaced when it expires, so it wins whenever it
    holds one. Returns where the login came from, for the log.
    """
    try:
        response = client.get(f"{web_url}/api/sync/suu-session", headers={"x-member-sync-secret": sync_secret})
        stored = response.json() if response.status_code == 200 else {}
    except (httpx.HTTPError, ValueError):
        stored = {}
    if stored.get("sessionId") or stored.get("authState"):
        for name in SESSION_ENV:
            os.environ.pop(name, None)
        if stored.get("sessionId"):
            os.environ["SUU_SESSION_ID"] = stored["sessionId"]
        else:
            auth_state = stored["authState"].strip()
            os.environ["SUU_AUTH_STATE_JSON" if auth_state.startswith("{") else "SUU_AUTH_STATE_BASE64"] = auth_state
        return "the portal"
    return "the SUU_SESSION_ID secret"


def main() -> None:
    web_url = os.environ.get("HIKING_WEB_URL", "").strip().rstrip("/")
    sync_secret = os.environ.get("MEMBER_SYNC_SECRET", "").strip()
    slug = os.environ.get("SUU_GROUP_SLUG", "hiking-club").strip()
    if not web_url or not sync_secret:
        print("HIKING_WEB_URL and MEMBER_SYNC_SECRET are required", file=sys.stderr)
        sys.exit(2)

    secret_env = {name: os.environ[name] for name in SESSION_ENV if os.environ.get(name)}

    with httpx.Client(timeout=30, follow_redirects=True) as client:
        attempts = [use_site_session(client, web_url, sync_secret)]
        if attempts[0] == "the portal" and secret_env:
            attempts.append("the SUU_SESSION_ID secret")

        members: list[dict[str, Any]] = []
        for source in attempts:
            if source != "the portal":
                for name in SESSION_ENV:
                    os.environ.pop(name, None)
                os.environ.update(secret_env)
            cookies = cookie_header(load_storage_state() or {})
            if not cookies:
                print("No SUU session: none saved in the portal and SUU_SESSION_ID is unset", file=sys.stderr)
                sys.exit(2)
            print(f"Using the SU login from {source}", file=sys.stderr)

            try:
                members = fetch_roster(client, slug, cookies)
                break
            except (SyncError, httpx.HTTPError) as error:
                message = f"Roster sync could not read the SU members page with the login from {source}: {error}"
                print(message, file=sys.stderr)
                expired = str(error).startswith("expired")
                # Only the portal's saved login is tracked by the site's session status; marking it
                # expired also stops the next run trying it until a principal saves a new one.
                if expired and source == "the portal":
                    client.post(
                        f"{web_url}/api/sync/session-status",
                        headers={"x-member-sync-secret": sync_secret},
                        json={"status": "expired", "error": message},
                    )
                if not expired or source == attempts[-1]:
                    sys.exit(1)

        if not members:
            print("The SU members page listed nobody; refusing to send an empty roster", file=sys.stderr)
            sys.exit(1)

        response = client.post(
            f"{web_url}/api/sync/roster",
            headers={"x-member-sync-secret": sync_secret},
            json={"source": "suu-roster", "members": members},
        )
        if response.status_code != 200:
            print(f"The hiking site refused the roster (HTTP {response.status_code}): {response.text[:300]}", file=sys.stderr)
            sys.exit(1)

    result = response.json()
    print(json.dumps({"ok": True, "suRows": len(members), **{k: result.get(k) for k in ("rosterRows", "skippedTypes", "updated", "revoked", "syncedAt")}}, sort_keys=True))


if __name__ == "__main__":
    main()
