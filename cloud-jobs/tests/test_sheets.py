from hiking_sync.sheets import format_event_sheet_rows, format_member_sheet_rows


def test_format_member_sheet_rows() -> None:
    members = [
        {
            "email": "hiker@ucl.ac.uk",
            "fullName": "Alice Hiker",
            "membershipTier": "explorer",
            "governanceRole": "committee",
            "isWalkLeader": True,
            "sourceReference": "PURCHASE-123",
        }
    ]

    rows = format_member_sheet_rows(members)
    assert len(rows) == 2
    assert rows[0] == ["Email", "Full Name", "Membership Tier", "Governance Role", "Walk Leader", "Source Ref"]
    assert rows[1] == ["hiker@ucl.ac.uk", "Alice Hiker", "explorer", "committee", "Yes", "PURCHASE-123"]


def test_format_event_sheet_rows() -> None:
    events = [
        {
            "suuEventId": "hike-001",
            "title": "Peak District Hike",
            "status": "upcoming",
            "startsAt": "2026-11-01",
            "location": "Sheffield",
            "capacity": 30,
            "ticketsSold": 12,
        }
    ]

    rows = format_event_sheet_rows(events)
    assert len(rows) == 2
    assert rows[0] == ["SU Event ID", "Title", "Status", "Starts At", "Location", "Capacity", "Tickets Sold"]
    assert rows[1] == ["hike-001", "Peak District Hike", "upcoming", "2026-11-01", "Sheffield", "30", "12"]
