"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

interface Account {
  id: string;
  full_name: string;
  email: string;
  current: boolean;
  alumnus: boolean;
  granted_at: string | null;
  /** The @alumni.ucl.ac.uk address they sign in with, once known. */
  alumni_email: string | null;
  /** Sign-in granted it itself, from an alumni address that matched them. */
  auto: boolean;
}

const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * Principals give former members alumni access: once their membership has
 * lapsed they can still sign in to read the Navigator and see the photo
 * albums of the trips they went on, and nothing else. The search reaches past
 * members, who aren't in the Members list above.
 *
 * Most alumni need nothing from here: signing in with an @alumni.ucl.ac.uk
 * address that matches a past member grants it (lib/alumniStore). When it
 * doesn't match, a principal grants it and types in the alumni address.
 */
export function AlumniAdmin({ viewerId }: { viewerId: string }) {
  const [alumni, setAlumni] = useState<Account[] | null>(null);
  const [results, setResults] = useState<Account[]>([]);
  const [ready, setReady] = useState(true);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const q = query.trim();
    // Debounced: the search runs once typing pauses.
    const timer = setTimeout(() => {
      fetch(`/api/admin/alumni${q.length >= 2 ? `?q=${encodeURIComponent(q)}` : ""}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Couldn't load alumni."))))
        .then((data: { alumni?: Account[]; results?: Account[]; ready?: boolean }) => {
          setAlumni(data.alumni ?? []);
          setResults(data.results ?? []);
          setReady(data.ready !== false);
        })
        .catch(() => {
          if (!controller.signal.aborted) setAlumni((a) => a ?? []);
        });
    }, q ? 250 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  async function set(account: Account, value: boolean, alumniEmail?: string) {
    setBusy(account.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/alumni/${account.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(alumniEmail === undefined ? { value } : { value, alumniEmail: alumniEmail.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save that change.");
      const updated: Account = {
        ...account,
        alumnus: value,
        granted_at: value ? (account.alumnus ? account.granted_at : new Date().toISOString()) : null,
        alumni_email: alumniEmail === undefined ? account.alumni_email : (data.alumni_email ?? null),
        auto: value && account.alumnus ? account.auto : false,
      };
      setEditing(null);
      setAlumni((list) => {
        const rest = (list ?? []).filter((a) => a.id !== account.id);
        return value ? [...rest, updated].sort((a, b) => a.full_name.localeCompare(b.full_name, "en-GB")) : rest;
      });
      setResults((list) => list.map((a) => (a.id === account.id ? updated : a)));
      const first = account.full_name.split(" ")[0];
      setMessage({
        tone: "ok",
        text:
          alumniEmail !== undefined
            ? `Saved ${first}'s alumni address.`
            : value
              ? `${first} has alumni access.`
              : `${first} no longer has alumni access.`,
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Couldn't save that change." });
    } finally {
      setBusy(null);
    }
  }

  const row = (account: Account) => (
    <li key={account.id} className="kit-item photo-trip">
      <span className="photo-trip-main">
        <span className="kit-item-name">{account.full_name}</span>
        <span className="kit-item-desc">{account.email}</span>
        <small>
          {account.current ? "Still a member" : "Membership lapsed"}
          {account.alumnus && account.granted_at ? ` · alumni since ${shortDate.format(new Date(account.granted_at))}` : ""}
          {account.alumnus && account.auto ? " · matched at sign-in" : ""}
        </small>
        {account.alumnus ? (
          editing === account.id ? (
            <form
              className="alumni-email-form"
              onSubmit={(e) => {
                e.preventDefault();
                void set(account, true, draft);
              }}
            >
              <input
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="name@alumni.ucl.ac.uk"
                aria-label={`${account.full_name}'s alumni email`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="submit" className="kit-btn primary" disabled={busy === account.id}>
                Save
              </button>
              <button type="button" className="kit-btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </form>
          ) : (
            <small>
              {account.alumni_email ? `Signs in as ${account.alumni_email}` : "No alumni address yet"}
              {account.id === viewerId ? null : (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="roster-link-button"
                    onClick={() => {
                      setDraft(account.alumni_email ?? "");
                      setEditing(account.id);
                    }}
                  >
                    {account.alumni_email ? "Change" : "Add"}
                  </button>
                </>
              )}
            </small>
          )
        ) : null}
      </span>
      {account.id === viewerId ? null : (
        <span className="photo-trip-actions">
          <button
            type="button"
            className={`kit-btn${account.alumnus ? " danger-text" : " primary"}`}
            disabled={busy === account.id}
            onClick={() => void set(account, !account.alumnus)}
          >
            {account.alumnus ? "Remove" : "Make alumnus"}
          </button>
        </span>
      )}
    </li>
  );

  return (
    <section className="event-section alumni-admin" aria-labelledby="alumni-title">
      <h3 id="alumni-title" className="event-section-title">
        Alumni
      </h3>
      <p className="member-note">
        Alumni can still sign in once their membership lapses, to read the Navigator and see the photo albums of the
        trips they went on. Nothing else in the app opens for them. Signing in with an @alumni.ucl.ac.uk address that
        matches a past member grants it automatically. If theirs doesn&apos;t match, make them an alumnus here and add
        the address they sign in with. Granted to a current member, it waits until their membership ends.
      </p>
      {!ready ? (
        <p className="member-note">Alumni access can be granted once the database is updated.</p>
      ) : (
        <>
          <div className="roster-toolbar">
            <label className="roster-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                inputMode="search"
                autoComplete="off"
                placeholder="Find a member or past member"
                aria-label="Find a member or past member by name or email"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          {query.trim().length >= 2 ? (
            results.length ? (
              <ul className="kit-list">{results.map(row)}</ul>
            ) : (
              <p className="day-note">Nobody matches that.</p>
            )
          ) : null}
          {message ? (
            <p className={message.tone === "error" ? "kit-form-error" : "member-note"} role="status">
              {message.text}
            </p>
          ) : null}
          {alumni === null ? (
            <p className="member-note">Loading…</p>
          ) : alumni.length ? (
            <ul className="kit-list">{alumni.map(row)}</ul>
          ) : (
            <p className="day-note">No alumni yet.</p>
          )}
        </>
      )}
    </section>
  );
}
