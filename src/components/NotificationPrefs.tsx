"use client";

import { useEffect, useState } from "react";
import { NOTIFICATION_KINDS, NOTIFICATION_LABELS, type NotificationKind } from "@/lib/notify";

/** What the member hears about. Walk changes are always on: a cancelled walk is not optional news. */
export function NotificationPrefs() {
  const [enabled, setEnabled] = useState<Record<NotificationKind, boolean> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/notifications/prefs")
      .then((res) => res.json())
      .then((body) => setEnabled(body.enabled))
      .catch(() => setError("Your settings didn't load."));
  }, []);

  async function toggle(kind: NotificationKind) {
    if (!enabled) return;
    const next = !enabled[kind];
    setEnabled({ ...enabled, [kind]: next });
    setError(null);
    const res = await fetch("/api/notifications/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, enabled: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setEnabled((current) => (current ? { ...current, [kind]: !next } : current));
      setError("That wasn't saved. Try again.");
    }
  }

  if (!enabled) return error ? <p className="account-note">{error}</p> : <div className="skeleton" style={{ height: 120 }} />;

  return (
    <>
      <ul className="member-roles notify-prefs">
        {NOTIFICATION_KINDS.map((kind) => {
          const { label, hint, optional } = NOTIFICATION_LABELS[kind];
          return (
            <li key={kind}>
              <span>
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
              <label className="notify-switch">
                <input type="checkbox" checked={enabled[kind]} disabled={!optional} onChange={() => toggle(kind)} />
                <span className="sr-only">{label}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {error ? <p className="kit-form-error">{error}</p> : null}
    </>
  );
}
