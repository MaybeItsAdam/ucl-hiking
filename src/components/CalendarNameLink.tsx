"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { nameKey } from "@/lib/walkSheet";

/**
 * "Which name is you on the WL calendar?" for a leader whose account isn't
 * tied to the roster, so My walks can find the walks they led. Only names
 * nobody has linked are offered; picking one puts their email on that row.
 */
export function CalendarNameLink({ names, guess }: { names: string[]; guess: string | null }) {
  const router = useRouter();
  const preset = guess ? (names.find((n) => nameKey(n) === nameKey(guess)) ?? "") : "";
  const [name, setName] = useState(preset);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/account/calendar-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wl_name: name }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "That didn't work.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "That didn't work.");
      setBusy(false);
    }
  }

  return (
    <form className="kit-form" onSubmit={submit}>
      <label className="kit-field">
        <span>Your name on the WL calendar</span>
        <select value={name} onChange={(e) => setName(e.target.value)} disabled={busy}>
          <option value="">Choose…</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      {message ? <p className="kit-form-error">{message}</p> : null}
      <div className="calendar-feed-actions">
        <button type="submit" className="kit-btn primary" disabled={busy || !name}>
          {busy ? "Linking…" : "That's me"}
        </button>
      </div>
    </form>
  );
}
