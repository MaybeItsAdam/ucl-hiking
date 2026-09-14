"""Cloud Run job: check the SUU session still signs in, then report it to the web app.

No browser: one HTTP request to the SU site's /user page. Drupal redirects that to the
signed-in account's profile, or to the login form once the session has expired.
"""

from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

import httpx

from .suu_session import SUU_BASE_URL, SUU_DOMAIN, cookie_header, load_storage_state

PROBE_URL = f"{SUU_BASE_URL}/user"
USER_AGENT = "Mozilla/5.0 (compatible; ucl-hiking-session-check/1.0)"
PROFILE_PATH = re.compile(r"/user/(\d+)/?")
BLOCKED_STATUSES = frozenset({403, 429, 503})


@dataclass(frozen=True)
class CheckResult:
    status: str  # a web app session status: active, expired, error or unconfigured
    detail: str


def classify_response(response: httpx.Response) -> CheckResult:
    if response.is_redirect:
        location = urljoin(str(response.url), response.headers.get("location", ""))
        path = urlparse(location).path
        profile = PROFILE_PATH.fullmatch(path)
        if profile:
            return CheckResult("active", f"Signed in as SU user {profile.group(1)}")
        if path.startswith("/user/login"):
            return CheckResult("expired", "SU site redirected to the login page, so the session has expired")
        return CheckResult("error", f"Unexpected redirect to {path}")

    if response.headers.get("cf-mitigated") or response.status_code in BLOCKED_STATUSES:
        return CheckResult(
            "error",
            f"SU site refused the check (HTTP {response.status_code}), so the session's health is unknown",
        )

    if response.status_code == 200 and 'name="pass"' in response.text:
        return CheckResult("expired", "SU site showed the login form, so the session has expired")

    return CheckResult("error", f"Unexpected HTTP {response.status_code} from the SU site")


def check_session(client: httpx.Client) -> CheckResult:
    try:
        state = load_storage_state()
    except ValueError as error:
        return CheckResult("error", f"SUU session is set but couldn't be read: {error}")
    if state is None:
        return CheckResult("unconfigured", "No SUU session configured (set SUU_SESSION_ID)")

    cookies = cookie_header(state)
    if not cookies:
        return CheckResult("error", f"SUU session has no cookies for {SUU_DOMAIN}")

    try:
        response = client.get(PROBE_URL, headers={"cookie": cookies, "user-agent": USER_AGENT})
    except httpx.HTTPError as error:
        return CheckResult("error", f"Couldn't reach the SU site: {error}")
    return classify_response(response)


def report_status(client: httpx.Client, web_url: str, sync_secret: str, result: CheckResult) -> bool:
    try:
        response = client.post(
            f"{web_url}/api/sync/session-status",
            headers={"x-member-sync-secret": sync_secret},
            json={"status": result.status, "error": None if result.status == "active" else result.detail},
        )
        response.raise_for_status()
    except httpx.HTTPError as error:
        print(f"Failed to report session status to the web app: {error}", file=sys.stderr)
        return False
    return True


def main() -> None:
    web_url = os.environ.get("HIKING_WEB_URL", "").strip().rstrip("/")
    sync_secret = os.environ.get("MEMBER_SYNC_SECRET", "").strip()

    with httpx.Client(timeout=15, follow_redirects=False) as client:
        result = check_session(client)
        checked_at = datetime.now(timezone.utc).isoformat()
        print(json.dumps({"status": result.status, "detail": result.detail, "checkedAt": checked_at}, sort_keys=True))

        reported = True
        if web_url and sync_secret:
            reported = report_status(client, web_url, sync_secret, result)
        elif web_url or sync_secret:
            print("Set both HIKING_WEB_URL and MEMBER_SYNC_SECRET to report to the web app", file=sys.stderr)

    # Non-zero marks the Cloud Run execution failed, which is what alerting keys off.
    if result.status != "active" or not reported:
        sys.exit(1)


if __name__ == "__main__":
    main()
