"""Translate raw SU event/ticket evidence into standardized event status rows."""

from __future__ import annotations

from typing import Any
import re


def build_event_sync_rows(raw_events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Process raw sales or event records from suu into event status records."""
    events_by_id: dict[str, dict[str, Any]] = {}

    for raw in raw_events:
        event_name = str(raw.get("event") or raw.get("title") or "Untitled Event").strip()
        event_id = str(raw.get("event_id") or raw.get("booking_ref") or re.sub(r"[^a-z0-9]+", "-", event_name.lower()).strip("-"))

        if not event_id:
            continue

        if event_id not in events_by_id:
            tickets_sold = int(raw.get("tickets_sold") or (1 if "ticket_code" in raw else 0))
            capacity = int(raw.get("capacity") or 0)
            status_str = str(raw.get("status") or "").lower()

            if "sold out" in status_str or (capacity > 0 and tickets_sold >= capacity):
                status = "sold_out"
            elif "cancell" in status_str:
                status = "cancelled"
            elif "draft" in status_str:
                status = "draft"
            elif "completed" in status_str or "past" in status_str:
                status = "completed"
            else:
                status = "upcoming"

            events_by_id[event_id] = {
                "suuEventId": event_id,
                "title": event_name,
                "startsAt": raw.get("starts_at") or raw.get("date"),
                "endsAt": raw.get("ends_at"),
                "location": raw.get("location") or raw.get("room"),
                "status": status,
                "capacity": capacity,
                "ticketsSold": tickets_sold,
                "pricePence": int(raw.get("price_pence") or 0),
                "sourceReference": str(raw.get("ticket_tier") or raw.get("booking_ref") or ""),
            }
        else:
            if "ticket_code" in raw:
                events_by_id[event_id]["ticketsSold"] += 1

    return list(events_by_id.values())
