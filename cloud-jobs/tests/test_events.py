from hiking_sync.events import build_event_sync_rows


def test_build_event_sync_rows() -> None:
    raw_sales = [
        {
            "event": "Weekend Hike to Box Hill",
            "event_id": "box-hill-2026",
            "ticket_code": "TCK001",
            "ticket_tier": "Standard Member",
            "capacity": 20,
            "date": "2026-10-15",
            "location": "Box Hill",
        },
        {
            "event": "Weekend Hike to Box Hill",
            "event_id": "box-hill-2026",
            "ticket_code": "TCK002",
            "ticket_tier": "Standard Member",
            "capacity": 20,
        },
        {
            "event": "Lake District Expedition",
            "event_id": "lake-district-2026",
            "status": "sold out",
            "capacity": 15,
            "tickets_sold": 15,
        },
    ]

    rows = build_event_sync_rows(raw_sales)
    assert len(rows) == 2

    box_hill = next(r for r in rows if r["suuEventId"] == "box-hill-2026")
    assert box_hill["title"] == "Weekend Hike to Box Hill"
    assert box_hill["ticketsSold"] == 2
    assert box_hill["status"] == "upcoming"

    lakes = next(r for r in rows if r["suuEventId"] == "lake-district-2026")
    assert lakes["status"] == "sold_out"
    assert lakes["ticketsSold"] == 15
