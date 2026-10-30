"use client";

import { useEffect, useState } from "react";
import type { WalkLeaderRequest } from "@/lib/walkLeaderRequests";

type Row = WalkLeaderRequest & { member: { full_name: string | null; email: string } | null };

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** Open walk leader requests, for the committee to approve or decline. Hidden when there are none. */
export function WalkLeaderRequests({ viewerId }: { viewerId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/walk-leader-requests")
      .then((res) => (res.ok ? res.json() : { requests: [] }))
      .then((body) => setRows(body.requests ?? []))
      .catch(() => setRows([]));
  }, []);

  async function decide(row: Row, decision: "approve" | "decline") {
    setBusy(row.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/walk-leader-requests/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "That didn't work.");
      setRows((current) => current.filter((r) => r.id !== row.id));
      const who = row.member?.full_name || row.member?.email || "They";
      setMessage(
        json.rosterWarning
          ? { tone: "bad", text: json.rosterWarning }
          : { tone: "ok", text: decision === "approve" ? `${who} is now a walk leader.` : "Declined." },
      );
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "That didn't work." });
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length && !message) return null;

  return (
    <section className="wl-requests" aria-labelledby="wl-requests-title">
      <h2 id="wl-requests-title" className="roster-stat-label">
        Walk leader requests
      </h2>
      {rows.length ? (
        <ul>
          {rows.map((row) => (
            <li key={row.id}>
              <div className="wl-request-who">
                <strong>{row.member?.full_name || row.member?.email}</strong>
                <span>
                  {row.wl_name ? <>&ldquo;{row.wl_name}&rdquo; on the WL calendar</> : "Not on the WL calendar yet"} ·{" "}
                  {dateFormat.format(new Date(row.created_at))}
                </span>
                {row.note ? <p>{row.note}</p> : null}
              </div>
              {row.member_id === viewerId ? (
                <span className="account-note">Your own request</span>
              ) : (
                <div className="calendar-feed-actions">
                  <button type="button" className="kit-btn primary" disabled={busy !== null} onClick={() => decide(row, "approve")}>
                    Approve
                  </button>
                  <button type="button" className="kit-btn" disabled={busy !== null} onClick={() => decide(row, "decline")}>
                    Decline
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {message ? <p className={message.tone === "bad" ? "kit-form-error" : "account-note"}>{message.text}</p> : null}
    </section>
  );
}
