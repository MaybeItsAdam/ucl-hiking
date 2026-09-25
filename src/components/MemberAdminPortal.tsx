"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Compass, Search, Shield, Users, X } from "lucide-react";
import { GOVERNANCE_LABELS, MEMBERSHIP_LABELS, type MembershipTier } from "@/lib/access";
import type { MembershipListEntry } from "@/lib/roster";
import { readCache, writeCache } from "@/lib/client-cache";
import { useAppRefresh } from "@/lib/refresh";

type Member = MembershipListEntry;

type RosterFilter = "all" | MembershipTier | "leaders" | "committee";

const FILTERS: { value: RosterFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "explorer", label: "Explorer" },
  { value: "standard", label: "Standard" },
  { value: "taster", label: "Taster" },
  { value: "leaders", label: "Leaders" },
  { value: "committee", label: "Committee" },
];

/** Rows rendered per "show more" step — keeps a full-year roster cheap on phones. */
const PAGE_SIZE = 100;
const EXPIRY_WARNING_MS = 30 * 24 * 60 * 60 * 1000;

const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function matchesFilter(member: Member, filter: RosterFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "leaders":
      return member.is_walk_leader;
    case "committee":
      return member.governance_role !== null;
    default:
      return member.membership_tier === filter;
  }
}

function matchesSearch(member: Member, query: string): boolean {
  if (!query) return true;
  return (
    member.full_name.toLowerCase().includes(query) ||
    (member.email?.toLowerCase().includes(query) ?? false)
  );
}

const ROSTER_CACHE_KEY = "roster";
type RosterCache = { members: Member[]; syncedAt: string | null; loadedAt: number };

export function MemberAdminPortal() {
  const [cached] = useState(() => readCache<RosterCache>(ROSTER_CACHE_KEY));
  const [members, setMembers] = useState<Member[] | null>(cached?.members ?? null);
  const [loadedAt, setLoadedAt] = useState(cached?.loadedAt ?? 0);
  const [syncedAt, setSyncedAt] = useState<string | null>(cached?.syncedAt ?? null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/roster", { signal });
      if (!res.ok) throw new Error(String(res.status));
      const data: { members?: Member[]; syncedAt?: string | null } = await res.json();
      if (signal?.aborted) return;
      const next = { members: data.members ?? [], syncedAt: data.syncedAt ?? null, loadedAt: Date.now() };
      writeCache<RosterCache>(ROSTER_CACHE_KEY, next);
      setMembers(next.members);
      setSyncedAt(next.syncedAt);
      setLoadedAt(next.loadedAt);
      setError(null);
    } catch {
      if (!signal?.aborted) setError("Couldn't load the membership list. Pull down to try again.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  useAppRefresh(() => {
    void load();
  });

  const query = search.trim().toLowerCase();

  const searched = useMemo(
    () => (members ?? []).filter((member) => matchesSearch(member, query)),
    [members, query],
  );

  const counts = useMemo(() => {
    const result = {} as Record<RosterFilter, number>;
    for (const { value } of FILTERS) {
      result[value] = searched.filter((member) => matchesFilter(member, value)).length;
    }
    return result;
  }, [searched]);

  // Filters that match nobody in the whole list (no Standard members yet, say) are just noise.
  const availableFilters = useMemo(
    () => FILTERS.filter(({ value }) => value === "all" || (members ?? []).some((member) => matchesFilter(member, value))),
    [members],
  );

  const visible = useMemo(
    () => searched.filter((member) => matchesFilter(member, filter)),
    [searched, filter],
  );

  const rosterCount = members?.filter((member) => member.on_roster).length ?? 0;
  const accountCount = members?.filter((member) => member.email).length ?? 0;

  const updateSearch = (value: string) => {
    setSearch(value);
    setLimit(PAGE_SIZE);
  };

  const updateFilter = (value: RosterFilter) => {
    setFilter(value);
    setLimit(PAGE_SIZE);
  };

  if (error) {
    return (
      <div className="roster-panel">
        <div className="roster-state is-error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!members) {
    return (
      <div className="roster-panel" aria-busy="true">
        <p className="sr-only" role="status">Loading members…</p>
        <ul className="skeleton-list" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i}>
              <span className="skeleton-lines">
                <span className="skeleton" />
                <span className="skeleton" />
              </span>
              <span className="skeleton skeleton-trailing" />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="roster-panel">
      <div className="roster-summary">
        <strong>{rosterCount}</strong> on the SU roster · <strong>{accountCount}</strong> signed in
        {syncedAt && <span> · synced {shortDate.format(new Date(syncedAt))}</span>}
      </div>

      <div className="roster-toolbar">
        <label className="roster-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            inputMode="search"
            autoComplete="off"
            placeholder="Search name or email"
            aria-label="Search members by name or email"
            value={search}
            onChange={(e) => updateSearch(e.target.value)}
          />
          {search && (
            <button type="button" onClick={() => updateSearch("")} aria-label="Clear search">
              <X size={15} />
            </button>
          )}
        </label>

        <div className="roster-filters" role="group" aria-label="Filter members">
          {availableFilters.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "active" : ""}
              aria-pressed={filter === value}
              onClick={() => updateFilter(value)}
            >
              {value !== "all" && value !== "leaders" && value !== "committee" && (
                <span className={`tier-dot tier-${value}`} aria-hidden="true" />
              )}
              {label}
              <span className="roster-filter-count">{counts[value]}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="roster-state">
          <Users size={18} />
          <span>No members match.</span>
          {(search || filter !== "all") && (
            <button
              type="button"
              className="roster-link-button"
              onClick={() => {
                updateSearch("");
                updateFilter("all");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="roster-columns" aria-hidden="true">
            <span>Member</span>
            <span>Access</span>
            <span>Expires</span>
          </div>
          <ul className="roster-list">
            {visible.slice(0, limit).map((member) => {
              const expiresAt = member.membership_expires_at ? new Date(member.membership_expires_at) : null;
              const msLeft = expiresAt ? expiresAt.getTime() - loadedAt : Infinity;
              const expiryState = msLeft < 0 ? "is-expired" : msLeft < EXPIRY_WARNING_MS ? "is-soon" : "";

              return (
                <li key={member.id} className="roster-row">
                  <strong className="roster-name">{member.full_name}</strong>
                  {member.email ? (
                    <a className="roster-email" href={`mailto:${member.email}`}>
                      {member.email}
                    </a>
                  ) : (
                    <span className="roster-email is-missing">Not signed in yet</span>
                  )}
                  <span className="roster-tags">
                    <span className="roster-tag">
                      <span className={`tier-dot tier-${member.membership_tier}`} aria-hidden="true" />
                      {MEMBERSHIP_LABELS[member.membership_tier]}
                    </span>
                    {member.member_type && !/^student/i.test(member.member_type) && (
                      <span className="roster-tag" title={member.member_type}>
                        {member.member_type.split(/[\s/]/)[0]}
                      </span>
                    )}
                    {!member.on_roster && (
                      <span className="roster-tag is-off-roster" title="Has a site account but isn't on the SU roster">
                        Not on SU roster
                      </span>
                    )}
                    {member.is_walk_leader && (
                      <span className="roster-tag is-leader" title="Walk leader">
                        <Compass size={11} aria-hidden="true" />
                        Leader
                      </span>
                    )}
                    {member.governance_role && (
                      <span className="roster-tag is-governance">
                        <Shield size={11} aria-hidden="true" />
                        {GOVERNANCE_LABELS[member.governance_role]}
                      </span>
                    )}
                  </span>
                  <span className={`roster-expiry ${expiryState}`}>
                    {expiresAt
                      ? `${msLeft < 0 ? "Expired " : ""}${shortDate.format(expiresAt)}`
                      : "End of year"}
                  </span>
                </li>
              );
            })}
          </ul>
          {visible.length > limit && (
            <button type="button" className="roster-more" onClick={() => setLimit(limit + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, visible.length - limit)} more of {visible.length - limit}
            </button>
          )}
        </>
      )}
    </div>
  );
}
