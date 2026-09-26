"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { SafetyDetails } from "@/lib/safety";

const EMPTY: SafetyDetails = { phone: null, contact_name: null, contact_relation: null, contact_phone: null, medical_notes: null };

/** The member's own emergency details: view, edit, delete. */
export function SafetyDetailsForm() {
  const [details, setDetails] = useState<SafetyDetails | null>(null);
  const [draft, setDraft] = useState<SafetyDetails>(EMPTY);
  const [state, setState] = useState<"loading" | "view" | "edit" | "off">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/account/safety")
      .then(async (res) => {
        const body = await res.json();
        if (res.status === 503) return setState("off");
        if (!res.ok) throw new Error(body.error);
        setDetails(body.details);
        setState("view");
      })
      .catch(() => {
        setMessage("Your details didn't load.");
        setState("view");
      });
  }, []);

  async function send(method: "PUT" | "DELETE", body?: SafetyDetails) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/account/safety", {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "That didn't work.");
      setDetails(json.details);
      setState("view");
      setMessage(method === "DELETE" ? "Deleted." : "Saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <div className="skeleton" style={{ height: 60 }} />;
  if (state === "off") return <p className="account-note">Emergency details aren&apos;t switched on yet.</p>;

  if (state === "view") {
    return (
      <div className="safety-view">
        {details ? (
          <dl className="member-facts">
            {details.phone ? <Row label="Your phone" value={details.phone} /> : null}
            {details.contact_phone ? (
              <Row
                label="Emergency contact"
                value={`${details.contact_name ?? "Contact"}${details.contact_relation ? ` (${details.contact_relation})` : ""} · ${details.contact_phone}`}
              />
            ) : null}
            {details.medical_notes ? <Row label="Medical notes" value={details.medical_notes} /> : null}
          </dl>
        ) : (
          <p className="account-note">You haven&apos;t added any.</p>
        )}
        <div className="calendar-feed-actions">
          <button
            type="button"
            className="kit-btn primary"
            onClick={() => {
              setDraft(details ?? EMPTY);
              setState("edit");
              setMessage(null);
            }}
          >
            {details ? "Edit" : "Add emergency details"}
          </button>
          {details ? (
            <button type="button" className="kit-btn danger-text" onClick={() => send("DELETE")} disabled={busy}>
              Delete
            </button>
          ) : null}
        </div>
        {message ? <p className="account-note">{message}</p> : null}
      </div>
    );
  }

  const set = (field: keyof SafetyDetails) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [field]: e.target.value }));

  return (
    <form
      className="kit-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void send("PUT", draft);
      }}
    >
      <Field label="Your mobile">
        <input type="tel" inputMode="tel" autoComplete="tel" value={draft.phone ?? ""} onChange={set("phone")} maxLength={40} />
      </Field>
      <div className="kit-form-row">
        <Field label="Emergency contact">
          <input value={draft.contact_name ?? ""} onChange={set("contact_name")} maxLength={100} placeholder="Name" />
        </Field>
        <Field label="Relationship">
          <input value={draft.contact_relation ?? ""} onChange={set("contact_relation")} maxLength={60} placeholder="Parent, partner…" />
        </Field>
      </div>
      <Field label="Their phone">
        <input type="tel" inputMode="tel" value={draft.contact_phone ?? ""} onChange={set("contact_phone")} maxLength={40} />
      </Field>
      <Field label="Medical notes (optional)">
        <textarea
          rows={3}
          value={draft.medical_notes ?? ""}
          onChange={set("medical_notes")}
          maxLength={1000}
          placeholder="Allergies, asthma, diabetes, medication you carry: anything a leader should know in an emergency."
        />
      </Field>
      {message ? <p className="kit-form-error">{message}</p> : null}
      <div className="calendar-feed-actions">
        <button type="submit" className="kit-btn primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="kit-btn" onClick={() => setState("view")}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="kit-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
