"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Search } from "lucide-react";
import type { ClubLink } from "@/lib/clubLinks";

type Draft = { path: string; destination: string; note: string };

/** The committee's short links: find one, repoint it, or make a new one. */
export function ClubLinks({ links, site }: { links: ClubLink[]; site: string }) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<number | "new" | null>(null);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return links;
    return links.filter((l) => `${l.path} ${l.destination} ${l.note}`.toLowerCase().includes(q));
  }, [links, search]);

  return (
    <>
      <section className="event-section" aria-labelledby="links-new">
        <h3 id="links-new" className="event-section-title">
          New link
        </h3>
        {editing === "new" ? (
          <LinkEditor id={null} initial={{ path: "/e/", destination: "", note: "" }} onDone={() => setEditing(null)} />
        ) : (
          <div className="calendar-feed-actions">
            <button type="button" className="kit-btn primary" onClick={() => setEditing("new")}>
              New link
            </button>
          </div>
        )}
      </section>

      <section className="event-section" aria-labelledby="links-all">
        <h3 id="links-all" className="event-section-title">
          {links.length} links
        </h3>
        <div className="roster-toolbar club-links-search">
          <label className="roster-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              inputMode="search"
              autoComplete="off"
              placeholder="Search links"
              aria-label="Search links by path, destination or note"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {shown.length ? (
          <ul className="kit-list club-links">
            {shown.map((link) =>
              editing === link.id ? (
                <li key={link.id} className="club-link-editing">
                  <LinkEditor id={link.id} initial={link} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li key={link.id} className="kit-item">
                  <button type="button" className="kit-item-main" onClick={() => setEditing(link.id)} aria-label={`Edit ${link.path}`}>
                    <span className="kit-item-name club-link-path">{link.path}</span>
                    <span className="kit-item-desc">→ {link.destination}</span>
                    {link.note ? <span className="kit-item-desc">{link.note}</span> : null}
                  </button>
                  <CopyButton text={`${site}${link.path}`} />
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="day-note">{links.length ? "No link matches that." : "No links yet."}</p>
        )}
      </section>
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="kit-icon-btn"
      aria-label={copied ? "Copied" : `Copy ${text}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard refused (permissions, insecure context): nothing to undo.
        }
      }}
    >
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
    </button>
  );
}

function LinkEditor({ id, initial, onDone }: { id: number | null; initial: Draft; onDone: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>({ path: initial.path, destination: initial.destination, note: initial.note });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: "POST" | "PUT" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(id === null ? "/api/club/links" : `/api/club/links/${id}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify(draft),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "That wasn't saved.");
      onDone();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That wasn't saved.");
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  return (
    <form
      className="kit-form club-link-form"
      onSubmit={(e) => {
        e.preventDefault();
        void call(id === null ? "POST" : "PUT");
      }}
    >
      <label className="kit-field">
        <span>Short link</span>
        <input value={draft.path} onChange={set("path")} placeholder="/e/trip-signup" autoCapitalize="off" autoCorrect="off" spellCheck={false} required />
        <span className="kit-field-hint">Starts with /e/ or /media/. Capitals don&apos;t matter to visitors.</span>
      </label>
      <label className="kit-field">
        <span>Goes to</span>
        <input value={draft.destination} onChange={set("destination")} placeholder="https://forms.gle/…" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} required />
      </label>
      <label className="kit-field">
        <span>Note</span>
        <input value={draft.note} onChange={set("note")} maxLength={200} placeholder="What it's for, who uses it" />
      </label>
      {error ? <p className="kit-form-error">{error}</p> : null}
      <div className="calendar-feed-actions">
        <button type="submit" className="kit-btn primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="kit-btn" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        {id !== null ? (
          <button
            type="button"
            className="kit-btn danger-text"
            disabled={busy}
            onClick={() => confirm(`Delete ${initial.path}? Anyone following it, from a poster or an old message, will get a page not found.`) && call("DELETE")}
          >
            Delete
          </button>
        ) : null}
      </div>
    </form>
  );
}
