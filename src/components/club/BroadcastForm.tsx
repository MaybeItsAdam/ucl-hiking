"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Send } from "lucide-react";

export interface BroadcastWalk {
  suuId: string;
  label: string;
}

type AudienceType = "all" | "tier" | "leaders" | "event";

/** Write once, reach members' inboxes and phones. Shows the head-count before sending. */
export function BroadcastForm({ walks }: { walks: BroadcastWalk[] }) {
  const [type, setType] = useState<AudienceType>("all");
  const [tier, setTier] = useState<"taster" | "standard" | "explorer">("explorer");
  const [event, setEvent] = useState(walks[0]?.suuId ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const audience = type === "tier" ? { type, tier } : type === "event" ? { type, eventSuuId: event } : { type };

  useEffect(() => {
    const params = new URLSearchParams({ type });
    if (type === "tier") params.set("tier", tier);
    if (type === "event") params.set("event", event);
    const controller = new AbortController();
    fetch(`/api/club/broadcast?${params}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => setCount(typeof json.count === "number" ? json.count : null))
      .catch(() => undefined);
    return () => controller.abort();
  }, [type, tier, event]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/club/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience, title, body, url: url || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "It wasn't sent.");
      setMessage({ ok: true, text: `Sent to ${json.inbox} ${json.inbox === 1 ? "inbox" : "inboxes"}${json.pushed ? `, ${json.pushed} phones` : ""}.` });
      setTitle("");
      setBody("");
      setUrl("");
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "It wasn't sent." });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <form className="kit-form club-form" onSubmit={send}>
      <div className="kit-form-row">
        <Field label="Send to">
          <select value={type} onChange={(e) => { setType(e.target.value as AudienceType); setConfirming(false); }}>
            <option value="all">Everyone</option>
            <option value="tier">A membership tier</option>
            <option value="leaders">Walk leaders and committee</option>
            <option value="event" disabled={!walks.length}>People on a walk</option>
          </select>
        </Field>
        {type === "tier" ? (
          <Field label="Tier">
            <select value={tier} onChange={(e) => setTier(e.target.value as typeof tier)}>
              <option value="explorer">Explorer</option>
              <option value="standard">Standard</option>
              <option value="taster">Taster</option>
            </select>
          </Field>
        ) : null}
        {type === "event" ? (
          <Field label="Walk">
            <select value={event} onChange={(e) => setEvent(e.target.value)}>
              {walks.map((w) => (
                <option key={w.suuId} value={w.suuId}>
                  {w.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>
      <Field label="Title">
        <input value={title} onChange={(e) => { setTitle(e.target.value); setConfirming(false); }} maxLength={140} required placeholder="Snowdon weekend: tickets live" />
      </Field>
      <Field label="Message (optional)">
        <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} />
      </Field>
      <Field label="Opens (optional)">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/portal/events" maxLength={200} />
      </Field>
      <p className="day-note">
        {count === null ? "Counting…" : `Reaches ${count} ${count === 1 ? "member" : "members"}.`} It goes to their inbox, and to their
        phone if they have the app and haven&apos;t turned club news off.
      </p>
      {message ? <p className={message.ok ? "club-ok" : "kit-form-error"}>{message.text}</p> : null}
      <div className="calendar-feed-actions">
        <button type="submit" className="kit-btn primary" disabled={busy || !title.trim() || !count}>
          <Send size={15} aria-hidden="true" />
          {busy ? "Sending…" : confirming ? `Send to ${count} now` : "Send"}
        </button>
        {confirming ? (
          <button type="button" className="kit-btn" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
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
