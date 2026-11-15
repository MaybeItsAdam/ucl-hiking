"use client";

import { useEffect, useRef, useState } from "react";
import type { WalkLeaderRequest } from "@/lib/walkLeaderRequests";

type Row = WalkLeaderRequest & { member: { full_name: string | null; email: string } | null };

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/**
 * Open walk leader requests. Principals, admins and the named committee
 * members approve or decline them; the rest of the committee only sees them.
 * Hidden when there are none, unless a notification sent the viewer here for
 * one request (`focusId`): that one is highlighted and scrolled to, or, if
 * someone has already dealt with it, they're told so.
 */
export function WalkLeaderRequests({
  viewerId,
  canApprove,
  focusId = null,
}: {
  viewerId: string;
  canApprove: boolean;
  focusId?: string | null;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const focusRef = useRef<HTMLLIElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/walk-leader-requests")
      .then((res) => (res.ok ? res.json() : { requests: [] }))
      .then((body) => setRows(body.requests ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoaded(true));
  }, []);

  const focusPending = focusId !== null && rows.some((r) => r.id === focusId);
  useEffect(() => {
    if (loaded && focusPending) focusRef.current?.scrollIntoView({ block: "center" });
  }, [loaded, focusPending]);

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

  // Sent here for a request that's no longer open: someone got there first.
  const focusGone = loaded && focusId !== null && !focusPending && !message;

  if (!rows.length && !message && !focusGone) return null;

  return (
    <section className="wl-requests" aria-labelledby="wl-requests-title">
      <h2 id="wl-requests-title" className="roster-stat-label">
        Walk leader requests
      </h2>
      {rows.length ? (
        <ul>
          {rows.map((row) => (
            <li
              key={row.id}
              ref={row.id === focusId ? focusRef : undefined}
              className={row.id === focusId ? "is-focused" : undefined}
            >
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
              ) : !canApprove ? (
                <span className="account-note">A principal approves this</span>
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
      {focusGone ? <p className="account-note">That request has already been dealt with.</p> : null}
      {message ? <p className={message.tone === "bad" ? "kit-form-error" : "account-note"}>{message.text}</p> : null}
    </section>
  );
}
