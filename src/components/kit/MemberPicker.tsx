"use client";

import { useEffect, useId, useState } from "react";
import { Search, X } from "lucide-react";

export interface PickedMember {
  id: string;
  full_name: string | null;
}

/**
 * Find a member by name, for handing kit to them or booking who they meet.
 * Names only (GET /api/members/search). Shows the chosen member with a way to
 * change them, or the search box until one is chosen.
 */
export function MemberPicker({
  label,
  value,
  onChange,
  placeholder = "Start typing a name",
}: {
  label: string;
  value: PickedMember | null;
  onChange: (member: PickedMember | null) => void;
  placeholder?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedMember[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || value) {
      const t = setTimeout(() => setResults([]), 0);
      return () => clearTimeout(t);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState("loading");
      fetch(`/api/members/search?q=${encodeURIComponent(q)}`, { signal: controller.signal, cache: "no-store" })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((body: { members?: PickedMember[] }) => {
          setResults(body.members ?? []);
          setState("idle");
        })
        .catch(() => {
          if (!controller.signal.aborted) setState("error");
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, value]);

  if (value) {
    return (
      <div className="kit-field">
        <span>{label}</span>
        <div className="kit-member-chosen">
          <strong>{value.full_name || "Club member"}</strong>
          <button type="button" className="kit-btn" onClick={() => onChange(null)}>
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="kit-field">
      <label htmlFor={id}>{label}</label>
      <div className="roster-search">
        <Search size={16} aria-hidden="true" />
        <input
          id={id}
          type="search"
          autoComplete="off"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
            <X size={15} />
          </button>
        )}
      </div>
      {query.trim().length >= 2 &&
        (results.length ? (
          <ul className="kit-list kit-scan-results" aria-label="Matching members">
            {results.map((m) => (
              <li key={m.id} className="kit-item">
                <button
                  type="button"
                  className="kit-item-main"
                  onClick={() => {
                    onChange(m);
                    setQuery("");
                  }}
                >
                  <span className="kit-item-name">{m.full_name || "Club member"}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="kit-scan-none">
            {state === "loading" ? "Searching…" : state === "error" ? "Couldn't search members. Try again." : "Nobody by that name."}
          </p>
        ))}
    </div>
  );
}
