"use client";

import { useEffect, useState } from "react";
import { CalendarDays, MapPin, Ticket, AlertCircle, Loader2, ExternalLink } from "lucide-react";
import type { SUEvent } from "@/lib/types";

export function SUEventsPortal() {
  const [events, setEvents] = useState<SUEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/events")
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => setEvents(data.events || []))
      .catch(() => setError("Failed to load synced Students' Union events"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="sync-monitor-card loading" style={{ marginTop: 24 }}>
        <Loader2 className="animate-spin" size={24} />
        <span>Loading Students&apos; Union events...</span>
      </div>
    );
  }

  return (
    <div className="equipment-portal-shell" style={{ marginTop: 24 }}>
      <div className="equipment-header">
        <div>
          <h2>Students&apos; Union Ticketed Events</h2>
          <p>
            Official Hiking Club activities, socials, and ticketed excursions synchronized from Students&apos; Union UCL.
          </p>
        </div>
        <a
          href="https://studentsunionucl.org/clubs-societies/hiking-club"
          target="_blank"
          rel="noreferrer"
          className="button compact"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <span>SU UCL Portal</span>
          <ExternalLink size={14} />
        </a>
      </div>

      {error && (
        <div className="alert-banner error">
          <AlertCircle size={18} />
          <p>{error}</p>
        </div>
      )}

      {events.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", background: "white", borderRadius: 16 }}>
          <CalendarDays size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
          <p style={{ opacity: 0.7 }}>No upcoming ticketed events found in the SU roster.</p>
        </div>
      ) : (
        <div className="equipment-grid">
          {events.map((ev) => {
            const date = ev.starts_at
              ? new Intl.DateTimeFormat("en-GB", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(ev.starts_at))
              : "Date TBA";

            const priceFormatted =
              ev.price_pence > 0 ? `£${(ev.price_pence / 100).toFixed(2)}` : "Free";

            const isSoldOut = ev.status === "sold_out" || (ev.capacity > 0 && ev.tickets_sold >= ev.capacity);

            return (
              <div key={ev.id} className="equipment-card">
                <div>
                  <div className="equipment-card-header">
                    <span className="category-badge">SU Event</span>
                    <span className={`condition-badge ${isSoldOut ? "needs_repair" : "excellent"}`}>
                      {isSoldOut ? "Sold Out" : "Tickets Available"}
                    </span>
                  </div>

                  <h3>{ev.title}</h3>

                  {ev.location && (
                    <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--ink)", opacity: 0.85 }}>
                      <MapPin size={14} style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />
                      {ev.location}
                    </p>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12, opacity: 0.8, marginBottom: 14 }}>
                    <span>
                      <CalendarDays size={14} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />
                      {date}
                    </span>
                    <span>
                      <Ticket size={14} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />
                      {priceFormatted}
                    </span>
                  </div>
                </div>

                <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px dashed var(--line)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                    <span>
                      Sold: <strong>{ev.tickets_sold}</strong>
                      {ev.capacity > 0 ? ` / ${ev.capacity}` : ""}
                    </span>
                    <a
                      href="https://studentsunionucl.org/clubs-societies/hiking-club"
                      target="_blank"
                      rel="noreferrer"
                      className="button primary compact"
                      style={{ fontSize: 11 }}
                    >
                      View on SU
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
