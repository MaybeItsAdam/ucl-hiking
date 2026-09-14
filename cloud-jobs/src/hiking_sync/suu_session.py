"""Reading the SUU session from the environment, without importing the heavy `suu` package."""

from __future__ import annotations

import base64
import json
import os
from typing import Any

SUU_DOMAIN = "studentsunionucl.org"
SUU_BASE_URL = f"https://{SUU_DOMAIN}"


def _cookie(name: str, value: str) -> dict[str, Any]:
    return {
        "name": name,
        "value": value,
        "domain": SUU_DOMAIN,
        "path": "/",
        "httpOnly": True,
        "secure": True,
        "sameSite": "Lax",
    }


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
                    cookies.append(_cookie(c_name.strip(), c_val.strip()))
        else:
            cookies = [
                _cookie(name, session_id)
                for name in (".AspNet.Cookies", "ASP.NET_SessionId", "SSESS41428e140b4dc9b07f8c5c3e1fd73f96")
            ]

        os.environ["SUU_AUTH_STATE_JSON"] = json.dumps({"cookies": cookies, "origins": []})


def load_storage_state() -> dict[str, Any] | None:
    """Return the Playwright storage state the sync job would use, or None if no session is set.

    Raises ValueError when a session is set but isn't valid base64/JSON.
    """
    setup_suu_session_env()
    b64_state = os.environ.get("SUU_AUTH_STATE_BASE64", "").strip()
    if b64_state:
        return json.loads(base64.b64decode(b64_state))
    raw_json = os.environ.get("SUU_AUTH_STATE_JSON", "").strip()
    if raw_json:
        return json.loads(raw_json)
    return None


def cookie_header(state: dict[str, Any]) -> str:
    """Build a Cookie header from the storage state's cookies for the SU site."""
    pairs = []
    for cookie in state.get("cookies", []):
        domain = str(cookie.get("domain", "")).lstrip(".")
        if domain == SUU_DOMAIN or domain.endswith(f".{SUU_DOMAIN}"):
            pairs.append(f"{cookie.get('name')}={cookie.get('value')}")
    return "; ".join(pairs)
