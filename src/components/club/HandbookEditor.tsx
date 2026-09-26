"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Edit a handbook page in place. `slug` null means a new page. */
export function HandbookEditor({ slug, title, body, canDelete }: { slug: string | null; title: string; body: string; canDelete: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(slug === null);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftBody, setDraftBody] = useState(body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = slug ?? draftTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

  async function call(method: "PUT" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/club/docs/${target}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "PUT" ? JSON.stringify({ title: draftTitle, body: draftBody }) : undefined,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "That wasn't saved.");
      if (method === "DELETE") router.push("/portal/club/handbook");
      else if (!slug) router.push(`/portal/club/handbook/${target}`);
      else {
        setEditing(false);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "That wasn't saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="calendar-feed-actions">
        <button type="button" className="kit-btn" onClick={() => setEditing(true)}>
          Edit page
        </button>
        {canDelete ? (
          <button type="button" className="kit-btn danger-text" onClick={() => confirm("Delete this page for everyone?") && call("DELETE")} disabled={busy}>
            Delete
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="kit-form"
      onSubmit={(e) => {
        e.preventDefault();
        void call("PUT");
      }}
    >
      <label className="kit-field">
        <span>Title</span>
        <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} maxLength={120} required />
      </label>
      <label className="kit-field">
        <span>Page</span>
        <textarea rows={16} value={draftBody} onChange={(e) => setDraftBody(e.target.value)} className="handbook-source" />
      </label>
      <p className="day-note">## for a heading, - for a bullet, 1. for a numbered step, **bold**, [text](https://link).</p>
      {error ? <p className="kit-form-error">{error}</p> : null}
      <div className="calendar-feed-actions">
        <button type="submit" className="kit-btn primary" disabled={busy || !target}>
          {busy ? "Saving…" : "Save"}
        </button>
        {slug ? (
          <button type="button" className="kit-btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
