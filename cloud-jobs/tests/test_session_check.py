import base64
import json

import httpx
import pytest

from hiking_sync.session_check import check_session, classify_response
from hiking_sync.suu_session import cookie_header, load_storage_state

SESSION_ENV = ("SUU_SESSION_ID", "SUU_AUTH_STATE_BASE64", "SUU_AUTH_STATE_JSON")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in SESSION_ENV:
        monkeypatch.delenv(name, raising=False)


def response(status: int, location: str | None = None, text: str = "", **headers: str) -> httpx.Response:
    if location:
        headers["location"] = location
    return httpx.Response(status, headers=headers, text=text, request=httpx.Request("GET", "https://studentsunionucl.org/user"))


def client_returning(result: httpx.Response, seen: list[httpx.Request]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(result.status_code, headers=result.headers, text=result.text)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_redirect_to_profile_is_active() -> None:
    result = classify_response(response(302, "https://studentsunionucl.org/user/4821"))
    assert result.status == "active"
    assert "4821" in result.detail


def test_relative_redirect_to_profile_is_active() -> None:
    assert classify_response(response(302, "/user/4821")).status == "active"


def test_redirect_to_login_is_expired() -> None:
    assert classify_response(response(302, "https://studentsunionucl.org/user/login")).status == "expired"


def test_login_form_page_is_expired() -> None:
    assert classify_response(response(200, text='<input name="pass" type="password">')).status == "expired"


def test_cloudflare_block_is_error_not_expired() -> None:
    assert classify_response(response(403)).status == "error"
    assert classify_response(response(200, **{"cf-mitigated": "challenge"})).status == "error"


def test_unconfigured_without_session() -> None:
    with httpx.Client() as client:
        assert check_session(client).status == "unconfigured"


def test_name_value_session_is_sent_as_cookie(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUU_SESSION_ID", "SSESSabc=secret-value")
    seen: list[httpx.Request] = []
    with client_returning(response(302, "/user/7"), seen) as client:
        assert check_session(client).status == "active"
    assert seen[0].headers["cookie"] == "SSESSabc=secret-value"
    assert seen[0].url == "https://studentsunionucl.org/user"


def test_base64_storage_state_is_read(monkeypatch: pytest.MonkeyPatch) -> None:
    state = {"cookies": [{"name": "SSESSabc", "value": "v", "domain": ".studentsunionucl.org"}], "origins": []}
    monkeypatch.setenv("SUU_AUTH_STATE_BASE64", base64.b64encode(json.dumps(state).encode()).decode())
    assert cookie_header(load_storage_state() or {}) == "SSESSabc=v"


def test_cookies_for_other_sites_are_not_sent() -> None:
    state = {"cookies": [{"name": "a", "value": "1", "domain": "example.com"}]}
    assert cookie_header(state) == ""


def test_unreadable_session_is_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUU_AUTH_STATE_JSON", "{not json")
    with httpx.Client() as client:
        assert check_session(client).status == "error"
