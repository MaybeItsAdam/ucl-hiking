"use client";

import { useCallback, useEffect, useState } from "react";
import { INCIDENT_LABELS, type IncidentKind } from "@/lib/incidents";

interface Incident {
  id: string;
  event_suu_id: string | null;
  occurred_at: string;
  kind: IncidentKind;
  description: string;
  actions_taken: string | null;
  follow_up: string | null;
  status: "open" | "closed";
  reporter: { full_name: string | null } | null;
}

const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" });

/** Principals' view of incident reports: read, add the follow-up, close. */
export function IncidentList({ eventNames }: { eventNames: Record<string, string> }) {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/incidents");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Reports didn't load.");
      setIncidents(json.incidents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reports didn't load.");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function update(id: string, status: "open" | "closed", followUp: string) {
    const res = await fetch("/api/incidents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, follow_up: followUp }),
    });
    if (res.ok) await load();
    else setError((await res.json()).error ?? "The report wasn't updated.");
  }

  if (error) return <p className="kit-form-error">{error}</p>;
  if (!incidents) return <div className="skeleton" style={{ height: 120 }} />;

  const open = incidents.filter((i) => i.status === "open");
  const shown = showClosed ? incidents : open;

  return (
    <>
      <div className="roster-bulk">
        <span>
          {open.length} open · {incidents.length - open.length} closed
        </span>
        <button type="button" className="kit-btn" onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? "Open only" : "Show closed"}
        </button>
      </div>
      {shown.length ? (
        <ul className="incident-list">
          {shown.map((incident) => (
            <IncidentRow key={incident.id} incident={incident} walk={incident.event_suu_id ? eventNames[incident.event_suu_id] : undefined} onUpdate={update} />
          ))}
        </ul>
      ) : (
        <p className="day-note">No open reports.</p>
      )}
    </>
  );
}

function IncidentRow({
  incident,
  walk,
  onUpdate,
}: {
  incident: Incident;
  walk: string | undefined;
  onUpdate: (id: string, status: "open" | "closed", followUp: string) => Promise<void>;
}) {
  const [followUp, setFollowUp] = useState(incident.follow_up ?? "");
  const [busy, setBusy] = useState(false);
  const closed = incident.status === "closed";

  async function save(status: "open" | "closed") {
    setBusy(true);
    await onUpdate(incident.id, status, followUp);
    setBusy(false);
  }

  return (
    <li className={closed ? "is-closed" : undefined}>
      <div className="incident-head">
        <span className={`kit-tag ${closed ? "is-returned" : "is-pending"}`}>{closed ? "Closed" : "Open"}</span>
        <strong>{INCIDENT_LABELS[incident.kind]}</strong>
        <span className="event-meta">
          {when.format(new Date(incident.occurred_at))}
          {walk ? ` · ${walk}` : ""}
          {incident.reporter?.full_name ? ` · reported by ${incident.reporter.full_name}` : ""}
        </span>
      </div>
      <p>{incident.description}</p>
      {incident.actions_taken ? (
        <p>
          <span className="event-eyebrow">What they did</span>
          <br />
          {incident.actions_taken}
        </p>
      ) : null}
      <label className="kit-field">
        <span>Follow-up</span>
        <textarea rows={2} value={followUp} onChange={(e) => setFollowUp(e.target.value)} maxLength={4000} placeholder="Told the SU, updated the risk assessment…" />
      </label>
      <div className="calendar-feed-actions">
        <button type="button" className="kit-btn" disabled={busy} onClick={() => save(incident.status)}>
          Save follow-up
        </button>
        <button type="button" className={`kit-btn${closed ? "" : " primary"}`} disabled={busy} onClick={() => save(closed ? "open" : "closed")}>
          {closed ? "Reopen" : "Close"}
        </button>
      </div>
    </li>
  );
}
