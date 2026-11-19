"use client";

import { useState, type FormEvent } from "react";
import { Sheet } from "@/components/Sheet";
import { WALK_LEADER_APPROVER, WALK_LEADER_CONFIRM } from "@/lib/walkLeaderApproval";
import type { WalkLeaderRequest } from "@/lib/walkLeaderRequests";

const NOT_LISTED = "";
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/**
 * Ask the committee for walk leader access, naming yourself on the WL
 * calendar. Pressing Apply first asks them to confirm they've been approved
 * by email (WALK_LEADER_APPROVER), so the button isn't a way to ask to be
 * trained. `initial` is their latest request, read on the server.
 */
export function WalkLeaderRequestForm({ initial }: { initial: WalkLeaderRequest | null }) {
  const [request, setRequest] = useState<WalkLeaderRequest | null>(initial);
  const [names, setNames] = useState<string[] | null>(null);
  const [state, setState] = useState<"view" | "confirm" | "edit">("view");
  const [wlName, setWlName] = useState(NOT_LISTED);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  /** After the confirmation: open the form, and load the calendar names to pick from. */
  function confirmed() {
    setWlName(NOT_LISTED);
    setNote("");
    setMessage(null);
    setState("edit");
    if (names !== null) return;
    fetch("/api/account/walk-leader-request")
      .then(async (res) => {
        const body = (await res.json()) as { names?: string[] | null };
        setNames(res.ok && Array.isArray(body.names) ? body.names : []);
      })
      .catch(() => setNames([]));
  }

  const pending = request?.status === "pending";

  if (state === "edit") {
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
          <select value={wlName} onChange={(e) => setWlName(e.target.value)} disabled={names === null}>
            <option value={NOT_LISTED}>{names === null ? "Loading…" : "I'm not on it yet"}</option>
            {(names ?? []).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
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
          <button type="button" className="kit-btn primary" onClick={() => setState("confirm")}>
            Apply to be a walk leader
          </button>
        )}
      </div>
      {message ? <p className="account-note">{message}</p> : null}

      {state === "confirm" ? (
        <Sheet onClose={() => setState("view")} labelledBy="wl-confirm-title">
          <h3 id="wl-confirm-title">Has {WALK_LEADER_APPROVER} approved you?</h3>
          <p>{WALK_LEADER_CONFIRM}</p>
          <div className="modal-actions">
            <button type="button" className="kit-btn" onClick={() => setState("view")}>
              Cancel
            </button>
            <button type="button" className="kit-btn primary" onClick={confirmed}>
              Confirm
            </button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
