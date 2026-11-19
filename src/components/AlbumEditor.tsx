"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Images } from "lucide-react";
import { Sheet } from "@/components/Sheet";

/**
 * Attach a trip's Google Photos shared album, change it or take it off.
 * Committee only; the API checks again.
 */
export function AlbumEditor({ eventId, eventName, url }: { eventId: string; eventName: string; url: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(value: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/album`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The album wasn't saved.");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The album wasn't saved.");
    } finally {
      setBusy(false);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  const titleId = `album-sheet-${eventId}`;
  return (
    <>
      <button
        type="button"
        className={`kit-btn${url ? "" : " primary"}`}
        onClick={() => {
          setDraft(url ?? "");
          setError(null);
          setOpen(true);
        }}
      >
        <Images size={15} aria-hidden="true" />
        {url ? "Edit album" : "Add album"}
      </button>
      {open ? (
        <Sheet onClose={() => setOpen(false)} labelledBy={titleId}>
          <h3 id={titleId}>Photo album</h3>
          <p>
            Paste the Google Photos shared-album link for {eventName}. The photo archive shows it to the people who were on
            the trip, and to the committee.
          </p>
          <p className="member-note">
            Anyone who has a shared-album link can open it and pass it on, so this keeps the album out of everyone
            else&apos;s way rather than locking it.
          </p>
          <form className="kit-form" onSubmit={save}>
            <label className="kit-field">
              <span>Shared-album link</span>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="https://photos.app.goo.gl/…"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <span className="kit-field-hint">In Google Photos: open the album, Share, then Copy link.</span>
            </label>
            {error ? <p className="kit-form-error">{error}</p> : null}
            <div className="calendar-feed-actions">
              <button type="submit" className="kit-btn primary" disabled={busy || !draft.trim()}>
                Save
              </button>
              <button type="button" className="kit-btn" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </button>
              {url ? (
                <button type="button" className="kit-btn danger-text" onClick={() => void send("")} disabled={busy}>
                  Remove
                </button>
              ) : null}
            </div>
          </form>
        </Sheet>
      ) : null}
    </>
  );
}
