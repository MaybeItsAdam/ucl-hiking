"""Translate SU roster evidence into Hiking's independent access dimensions."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
import re
from typing import Any


TIER_RANK = {"taster": 0, "standard": 1, "explorer": 2}


@dataclass(frozen=True)
class RolePolicy:
    admin_emails: frozenset[str] = frozenset()
    walk_leader_emails: frozenset[str] = frozenset()
    principal_role_keywords: tuple[str, ...] = ("president", "treasurer")


def normalize_email(value: object) -> str:
    return str(value or "").strip().lower()


def normalize_name(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def membership_tier(label: object) -> str:
    value = str(label or "").lower()
    if "explorer" in value:
        return "explorer"
    if "taster" in value or "trial" in value:
        return "taster"
    return "standard"


def build_sync_rows(
    members: Iterable[dict[str, Any]],
    committee: Iterable[dict[str, Any]],
    policy: RolePolicy,
) -> list[dict[str, Any]]:
    """Build one authoritative row per email without conflating tier and duties."""
    committee_by_email: dict[str, list[str]] = {}
    committee_by_name: dict[str, list[str]] = {}
    for seat in committee:
        role = str(seat.get("role") or "")
        email = normalize_email(seat.get("email"))
        name = normalize_name(seat.get("name"))
        if email:
            committee_by_email.setdefault(email, []).append(role)
        if name:
            committee_by_name.setdefault(name, []).append(role)

    by_email: dict[str, dict[str, Any]] = {}
    for raw in members:
        email = normalize_email(raw.get("email"))
        if not email or "@" not in email:
            continue
        tier = membership_tier(raw.get("membership_type"))
        current = by_email.get(email)
        if current and TIER_RANK[current["membershipTier"]] > TIER_RANK[tier]:
            continue

        name = str(raw.get("name") or "").strip()
        roles = committee_by_email.get(email) or committee_by_name.get(normalize_name(name), [])
        role_text = " ".join(roles).lower()
        if email in policy.admin_emails:
            governance_role = "admin"
        elif any(keyword in role_text for keyword in policy.principal_role_keywords):
            governance_role = "principal"
        elif roles:
            governance_role = "committee"
        else:
            governance_role = None

        is_walk_leader = email in policy.walk_leader_emails or "walk leader" in role_text
        by_email[email] = {
            "email": email,
            "fullName": name or None,
            "membershipTier": tier,
            "governanceRole": governance_role,
            "isWalkLeader": is_walk_leader,
            "membershipExpiresAt": None,
            "sourceReference": str(raw.get("purchase_date") or "") or None,
        }

    return sorted(by_email.values(), key=lambda row: row["email"])
