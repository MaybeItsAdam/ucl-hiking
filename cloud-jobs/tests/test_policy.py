from hiking_sync.policy import RolePolicy, build_sync_rows


def test_standard_walk_leader_does_not_become_explorer():
    rows = build_sync_rows(
        [{"name": "Alex Hill", "email": "alex@ucl.ac.uk", "membership_type": "Standard"}],
        [],
        RolePolicy(walk_leader_emails=frozenset({"alex@ucl.ac.uk"})),
    )
    assert rows[0]["membershipTier"] == "standard"
    assert rows[0]["isWalkLeader"] is True
    assert rows[0]["governanceRole"] is None


def test_principal_is_derived_from_committee_without_changing_tier():
    rows = build_sync_rows(
        [{"name": "Priya Moss", "email": "priya@ucl.ac.uk", "membership_type": "Explorer"}],
        [{"name": "Priya Moss", "email": "", "role": "President"}],
        RolePolicy(),
    )
    assert rows[0]["membershipTier"] == "explorer"
    assert rows[0]["governanceRole"] == "principal"


def test_admin_is_an_explicit_override_not_inferred_from_su_role():
    rows = build_sync_rows(
        [{"name": "Ada", "email": "ada@ucl.ac.uk", "membership_type": "Taster"}],
        [{"name": "Ada", "email": "ada@ucl.ac.uk", "role": "Webmaster"}],
        RolePolicy(admin_emails=frozenset({"ada@ucl.ac.uk"})),
    )
    assert rows[0]["membershipTier"] == "taster"
    assert rows[0]["governanceRole"] == "admin"
