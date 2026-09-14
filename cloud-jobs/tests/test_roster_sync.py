import json
import os

import httpx
import pytest

from hiking_sync.roster_sync import membership_end, parse_members_page, use_site_session


def row(name: str, end_attr: bool = True) -> str:
    end = '<time datetime="2027-08-30T22:59:59Z" class="datetime">30/08/2027</time>' if end_attr else '<time class="datetime">30/08/2027</time>'
    return f"""
    <tr>
      <td class="views-field views-field-field-full-name"> {name} </td>
      <td class="views-field views-field-roles-target-id"> Student member </td>
      <td class="views-field views-field-field-membership-type"> Taster </td>
      <td class="views-field views-field-date-range__value"><time class="datetime">14/09/2026</time> - {end}</td>
      <td class="views-field views-field-over-18"> Yes </td>
    </tr>"""


def page(rows: list[str], next_page: bool = False) -> str:
    pager = '<li class="pager__item pager__item--next"><a href="?page=1">Next</a></li>' if next_page else ""
    return f'<table class="views-table views-view-table cols-5"><tbody>{"".join(rows)}</tbody></table><ul>{pager}</ul>'


def test_parses_columns_by_class_and_drops_over_18() -> None:
    members, has_next, recognised = parse_members_page(page([row("Ada O&#039;Lovelace")], next_page=True))
    assert recognised and has_next
    assert members == [
        {
            "fullName": "Ada O'Lovelace",
            "memberType": "Student member",
            "membershipType": "Taster",
            "membershipExpiresAt": "2027-08-30T22:59:59+00:00",
        }
    ]


def test_end_date_without_datetime_attribute_is_end_of_day_in_london() -> None:
    members, _, _ = parse_members_page(page([row("Ada Lovelace", end_attr=False)]))
    assert members[0]["membershipExpiresAt"] == "2027-08-30T22:59:59+00:00"
    assert membership_end('<time class="datetime">15/01/2027</time> - <time class="datetime">15/01/2027</time>') == "2027-01-15T23:59:59+00:00"


def test_login_page_is_not_recognised() -> None:
    members, has_next, recognised = parse_members_page('<form id="user-login-form"></form>')
    assert (members, has_next, recognised) == ([], False, False)


@pytest.fixture
def clean_session_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("SUU_SESSION_ID", "SUU_AUTH_STATE_BASE64", "SUU_AUTH_STATE_JSON"):
        monkeypatch.delenv(name, raising=False)


def site(body: dict, status: int = 200) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-member-sync-secret"] == "s3cret"
        return httpx.Response(status, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_portal_session_wins_over_the_secret(clean_session_env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUU_SESSION_ID", "SSESSold=from-secret")
    with site({"sessionId": "SSESSnew=from-portal", "authState": None}) as client:
        assert use_site_session(client, "https://hiking.test", "s3cret") == "the portal"
    assert os.environ["SUU_SESSION_ID"] == "SSESSnew=from-portal"


def test_falls_back_to_the_secret_when_the_portal_has_none(clean_session_env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUU_SESSION_ID", "SSESSold=from-secret")
    with site({"sessionId": None, "authState": None, "status": "expired"}) as client:
        assert use_site_session(client, "https://hiking.test", "s3cret") == "the SUU_SESSION_ID secret"
    assert os.environ["SUU_SESSION_ID"] == "SSESSold=from-secret"


def test_falls_back_when_the_site_errors(clean_session_env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUU_SESSION_ID", "SSESSold=from-secret")
    with site({"error": "boom"}, status=500) as client:
        assert use_site_session(client, "https://hiking.test", "s3cret") == "the SUU_SESSION_ID secret"


def test_expired_portal_login_falls_back_to_the_secret_in_the_same_run(clean_session_env: None, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    from hiking_sync import roster_sync

    monkeypatch.setenv("HIKING_WEB_URL", "https://hiking.test")
    monkeypatch.setenv("MEMBER_SYNC_SECRET", "s3cret")
    monkeypatch.setenv("SUU_SESSION_ID", "SSESSgood=from-secret-value")
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.endswith("/api/sync/suu-session"):
            return httpx.Response(200, json={"sessionId": "SSESSdead=from-portal-value", "authState": None})
        if url.endswith("/api/sync/session-status"):
            calls.append("reported-expired")
            return httpx.Response(200, json={"ok": True})
        if "/members" in url:
            if "SSESSdead" in request.headers["cookie"]:
                return httpx.Response(302, headers={"location": "https://studentsunionucl.org/user/login"})
            return httpx.Response(200, text=page([row("Ada Lovelace")]))
        if url.startswith("https://studentsunionucl.org/user/login"):
            return httpx.Response(200, text="<form id='user-login-form'></form>")
        if url.endswith("/api/sync/roster"):
            calls.append(f"posted-{len(json.loads(request.content)['members'])}")
            return httpx.Response(200, json={"rosterRows": 1, "updated": 0, "revoked": 0})
        raise AssertionError(url)

    real_client = httpx.Client
    monkeypatch.setattr(roster_sync.httpx, "Client", lambda **kw: real_client(transport=httpx.MockTransport(handler), follow_redirects=True))
    roster_sync.main()
    assert calls == ["reported-expired", "posted-1"]
    assert "from the SUU_SESSION_ID secret" in capsys.readouterr().err
