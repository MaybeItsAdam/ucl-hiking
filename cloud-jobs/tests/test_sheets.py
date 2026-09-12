from hiking_sync.sheets import (
    format_dashboard_sheet_rows,
    format_equipment_ledger_sheet_rows,
    format_equipment_master_sheet_rows,
    format_event_sheet_rows,
    format_member_sheet_rows,
)


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


def test_format_equipment_master_sheet_rows() -> None:
    equipment = [
        {
            "id": "eq-001",
            "name": "MSR Hubba Hubba 2P Tent",
            "category": "Tents & Shelter",
            "description": "2 person lightweight backpacking tent",
            "totalQuantity": 5,
            "availableQuantity": 3,
            "condition": "good",
            "updatedAt": "2026-09-06T10:00:00Z",
        }
    ]

    rows = format_equipment_master_sheet_rows(equipment)
    assert len(rows) == 2
    assert rows[0] == [
        "Equipment ID",
        "Item Name",
        "Category",
        "Description",
        "Total Quantity",
        "Available Quantity",
        "On Loan Quantity",
        "Condition",
        "Last Updated",
    ]
    assert rows[1] == [
        "eq-001",
        "MSR Hubba Hubba 2P Tent",
        "Tents & Shelter",
        "2 person lightweight backpacking tent",
        "5",
        "3",
        "2",
        "good",
        "2026-09-06T10:00:00Z",
    ]


def test_format_equipment_ledger_sheet_rows() -> None:
    requests = [
        {
            "id": "req-100",
            "createdAt": "2026-09-06T09:00:00Z",
            "member": {
                "fullName": "Alice Walker",
                "email": "alice@ucl.ac.uk",
                "membershipTier": "standard",
            },
            "equipment": {
                "name": "Silva Compass",
            },
            "quantity": 1,
            "startDate": "2026-09-10",
            "endDate": "2026-09-12",
            "purpose": "Brecon Beacons hike",
            "status": "approved",
            "reviewedBy": "comm@ucl.ac.uk",
            "notes": "Returned on time",
        }
    ]

    rows = format_equipment_ledger_sheet_rows(requests)
    assert len(rows) == 2
    assert rows[0] == [
        "Request ID",
        "Timestamp",
        "Member Name",
        "Member Email",
        "Membership Tier",
        "Equipment Item",
        "Qty",
        "Start Date",
        "End Date",
        "Purpose",
        "Status",
        "Reviewed By",
        "Notes",
    ]
    assert rows[1] == [
        "req-100",
        "2026-09-06T09:00:00Z",
        "Alice Walker",
        "alice@ucl.ac.uk",
        "standard",
        "Silva Compass",
        "1",
        "2026-09-10",
        "2026-09-12",
        "Brecon Beacons hike",
        "approved",
        "comm@ucl.ac.uk",
        "Returned on time",
    ]


def test_format_dashboard_sheet_rows() -> None:
    rows = format_dashboard_sheet_rows()
    assert len(rows) >= 15
    assert "Dashboard" in rows[0][0]
    metric_labels = [r[0] for r in rows]
    assert "Total Gear Varieties" in metric_labels
    assert "Total Units in Fleet" in metric_labels
    assert "Units Currently on Loan" in metric_labels
    assert "Tents & Shelter" in metric_labels

