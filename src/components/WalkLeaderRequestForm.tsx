"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { WalkLeaderRequest } from "@/lib/walkLeaderRequests";

const NOT_LISTED = "";
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** Ask the committee for walk leader access, naming yourself on the WL calendar. */
export function WalkLeaderRequestForm() {
  const [request, setRequest] = useState<WalkLeaderRequest | null>(null);
  const [names, setNames] = useState<string[] | null>(null);
  const [state, setState] = useState<"loading" | "view" | "edit" | "off">("loading");
  const [wlName, setWlName] = useState(NOT_LISTED);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/account/walk-leader-request")
      .then(async (res) => {
        const body = await res.json();
        if (res.status === 503) return setState("off");
        if (!res.ok) throw new Error(body.error);
        setRequest(body.request);
        setNames(body.names);
        setState("view");
      })
      .catch(() => {
        setMessage("Your request didn't load.");
        setState("view");
      });
  }, []);

  async function send(method: "POST" | "DELETE", body?: { wl_name: string | null; note: string }) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/account/walk-leader-request", {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "That didn't work.");
      setRequest(json.request);
      setState("view");
      setMessage(method === "DELETE" ? "Withdrawn." : "Sent. The committee will get a notification.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <div className="skeleton" style={{ height: 60 }} />;
  if (state === "off") return <p className="account-note">Walk leader requests aren&apos;t switched on yet.</p>;

  if (state === "view") {
    const pending = request?.status === "pending";
    return (
      <div className="safety-view">
        {pending ? (
          <p className="account-note">
            You asked on {dateFormat.format(new Date(request.created_at))}
            {request.wl_name ? <>, as <strong>{request.wl_name}</strong> on the WL calendar</> : null}. The committee
            will review it.
          </p>
        ) : request?.status === "declined" ? (
          <p className="account-note">Your last request was declined. Talk to the committee before asking again.</p>
        ) : null}
        <div className="calendar-feed-actions">
          {pending ? (
            <button type="button" className="kit-btn danger-text" onClick={() => send("DELETE")} disabled={busy}>
              Withdraw request
            </button>
          ) : (
            <button
              type="button"
              className="kit-btn primary"
              onClick={() => {
                setWlName(NOT_LISTED);
                setNote("");
                setState("edit");
                setMessage(null);
              }}
            >
              Request walk leader access
            </button>
          )}
        </div>
        {message ? <p className="account-note">{message}</p> : null}
      </div>
    );
  }

  return (
    <form
      className="kit-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void send("POST", { wl_name: wlName || null, note });
      }}
    >
      <label className="kit-field">
        <span>Your name on the WL calendar</span>
        <select value={wlName} onChange={(e) => setWlName(e.target.value)}>
          <option value={NOT_LISTED}>I&apos;m not on it yet</option>
          {(names ?? []).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      {names === null ? <p className="account-note">The WL calendar names didn&apos;t load. You can still ask.</p> : null}
      <label className="kit-field">
        <span>Note for the committee (optional)</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="When you did your training, who you shadowed…" />
      </label>
      {message ? <p className="kit-form-error">{message}</p> : null}
      <div className="calendar-feed-actions">
        <button type="submit" className="kit-btn primary" disabled={busy}>
          {busy ? "Sending…" : "Send request"}
        </button>
        <button type="button" className="kit-btn" onClick={() => setState("view")}>
          Cancel
        </button>
      </div>
    </form>
  );
}
