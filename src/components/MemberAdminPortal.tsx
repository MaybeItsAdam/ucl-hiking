"use client";

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { AlertCircle, Compass, Copy, Download, Lock, Search, Shield, Users, X } from "lucide-react";
import {
  canChangeRole,
  GOVERNANCE_LABELS,
  MEMBERSHIP_LABELS,
  type GovernanceRole,
  type MembershipTier,
  type RoleChange,
} from "@/lib/access";
import type { MembershipListEntry } from "@/lib/roster";
import { readCache, writeCache } from "@/lib/client-cache";
import { useAppRefresh } from "@/lib/refresh";
import { Sheet } from "@/components/Sheet";

type Member = MembershipListEntry;

type RosterFilter =
  | "all"
  | MembershipTier
  | "leaders"
  | "committee"
  | "expiring"
  | "not_signed_in"
  | "off_roster"
  | "locked";

const FILTERS: { value: RosterFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "explorer", label: "Explorer" },
  { value: "standard", label: "Standard" },
  { value: "taster", label: "Taster" },
  { value: "leaders", label: "Leaders" },
  { value: "committee", label: "Committee" },
  { value: "expiring", label: "Expiring soon" },
  { value: "not_signed_in", label: "Not signed in" },
  { value: "off_roster", label: "Not on SU roster" },
  { value: "locked", label: "Set by hand" },
];

const TIER_FILTERS = new Set<RosterFilter>(["explorer", "standard", "taster"]);

/** Rows rendered per "show more" step — keeps a full-year roster cheap on phones. */
const PAGE_SIZE = 100;
const EXPIRY_WARNING_MS = 30 * 24 * 60 * 60 * 1000;

const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function msUntilExpiry(member: Member, now: number): number {
  return member.membership_expires_at ? new Date(member.membership_expires_at).getTime() - now : Infinity;
}

function matchesFilter(member: Member, filter: RosterFilter, now: number): boolean {
  switch (filter) {
    case "all":
      return true;
    case "leaders":
      return member.is_walk_leader;
    case "committee":
      return member.governance_role !== null;
    case "expiring": {
      const left = msUntilExpiry(member, now);
      return left >= 0 && left < EXPIRY_WARNING_MS;
    }
    case "not_signed_in":
      return !member.email;
    case "off_roster":
      return !member.on_roster;
    case "locked":
      return member.governance_role_locked || member.walk_leader_locked;
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

function csvCell(value: string): string {
  // A leading = + - @ would run as a formula in Excel or Sheets; names come from outside.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(members: Member[]): string {
  const header = ["Name", "Email", "Tier", "SU member type", "Expires", "Walk leader", "Committee role", "On SU roster"];
  const rows = members.map((m) => [
    m.full_name,
    m.email ?? "",
    MEMBERSHIP_LABELS[m.membership_tier],
    m.member_type ?? "",
    m.membership_expires_at ? m.membership_expires_at.slice(0, 10) : "",
    m.is_walk_leader ? "Yes" : "",
    m.governance_role ? GOVERNANCE_LABELS[m.governance_role] : "",
    m.on_roster ? "Yes" : "No",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

const ROSTER_CACHE_KEY = "roster";
type RosterCache = { members: Member[]; syncedAt: string | null; loadedAt: number };

export interface RosterViewer {
  id: string;
  governanceRole: GovernanceRole | null;
}

export function MemberAdminPortal({ viewer }: { viewer: RosterViewer }) {
  const [cached] = useState(() => readCache<RosterCache>(ROSTER_CACHE_KEY));
  const [members, setMembers] = useState<Member[] | null>(cached?.members ?? null);
  const [loadedAt, setLoadedAt] = useState(cached?.loadedAt ?? 0);
  const [syncedAt, setSyncedAt] = useState<string | null>(cached?.syncedAt ?? null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [open, setOpen] = useState<Member | null>(null);
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);

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

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const query = search.trim().toLowerCase();

  const searched = useMemo(
    () => (members ?? []).filter((member) => matchesSearch(member, query)),
    [members, query],
  );

  const counts = useMemo(() => {
    const result = {} as Record<RosterFilter, number>;
    for (const { value } of FILTERS) {
      result[value] = searched.filter((member) => matchesFilter(member, value, loadedAt)).length;
    }
    return result;
  }, [searched, loadedAt]);

  // Filters that match nobody in the whole list (no Standard members yet, say) are just noise.
  const availableFilters = useMemo(
    () =>
      FILTERS.filter(
        ({ value }) => value === "all" || (members ?? []).some((member) => matchesFilter(member, value, loadedAt)),
      ),
    [members, loadedAt],
  );

  const visible = useMemo(
    () => searched.filter((member) => matchesFilter(member, filter, loadedAt)),
    [searched, filter, loadedAt],
  );

  const stats = useMemo(() => {
    const all = members ?? [];
    return {
      roster: all.filter((m) => m.on_roster).length,
      signedIn: all.filter((m) => m.email).length,
      explorers: all.filter((m) => m.membership_tier === "explorer").length,
      leaders: all.filter((m) => m.is_walk_leader).length,
      expiring: all.filter((m) => matchesFilter(m, "expiring", loadedAt)).length,
    };
  }, [members, loadedAt]);

  const updateSearch = (value: string) => {
    setSearch(value);
    setLimit(PAGE_SIZE);
  };

  const updateFilter = (value: RosterFilter) => {
    setFilter(value);
    setLimit(PAGE_SIZE);
  };

  const emails = visible.flatMap((m) => (m.email ? [m.email] : []));

  async function copyEmails() {
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      setToast({ tone: "success", text: `Copied ${emails.length} email${emails.length === 1 ? "" : "s"}. Paste them into Bcc.` });
    } catch {
      setToast({ tone: "error", text: "Couldn't reach the clipboard." });
    }
  }

  function downloadCsv() {
    const blob = new Blob([toCsv(visible)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `hiking-members-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function applyUpdate(memberId: string, patch: Partial<Member>) {
    setMembers((current) => {
      if (!current) return current;
      const next = current.map((m) => (m.member_id === memberId ? { ...m, ...patch } : m));
      writeCache<RosterCache>(ROSTER_CACHE_KEY, { members: next, syncedAt, loadedAt });
      return next;
    });
    setOpen((current) => (current?.member_id === memberId ? { ...current, ...patch } : current));
  }

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
      <div className="roster-stats">
        <Stat label="On SU roster" value={stats.roster} />
        <Stat label="Signed in" value={stats.signedIn} />
        <Stat label="Explorers" value={stats.explorers} />
        <Stat label="Leaders" value={stats.leaders} />
        <button
          type="button"
          className={`roster-stat${stats.expiring ? " is-warn" : ""}`}
          onClick={() => updateFilter("expiring")}
          disabled={!stats.expiring}
        >
          <span className="roster-stat-label">Expiring in 30 days</span>
          <strong>{stats.expiring}</strong>
        </button>
      </div>
      {syncedAt && <p className="roster-summary">SU roster synced {shortDate.format(new Date(syncedAt))}</p>}

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
              {TIER_FILTERS.has(value) && <span className={`tier-dot tier-${value}`} aria-hidden="true" />}
              {label}
              <span className="roster-filter-count">{counts[value]}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length > 0 && (
        <div className="roster-bulk">
          <span>
            {visible.length} shown · {emails.length} with email
          </span>
          <button type="button" className="kit-btn" onClick={copyEmails} disabled={!emails.length}>
            <Copy size={14} aria-hidden="true" /> Copy emails
          </button>
          <button type="button" className="kit-btn" onClick={downloadCsv}>
            <Download size={14} aria-hidden="true" /> CSV
          </button>
        </div>
      )}

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
            {visible.slice(0, limit).map((member) => (
              <RosterRow key={member.id} member={member} now={loadedAt} onOpen={() => setOpen(member)} />
            ))}
          </ul>
          {visible.length > limit && (
            <button type="button" className="roster-more" onClick={() => setLimit(limit + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, visible.length - limit)} more of {visible.length - limit}
            </button>
          )}
        </>
      )}

      {open && (
        <MemberSheet
          member={open}
          viewer={viewer}
          now={loadedAt}
          onClose={() => setOpen(null)}
          onUpdated={applyUpdate}
          onMessage={setToast}
        />
      )}

      {toast && (
        <div className={`kit-toast is-${toast.tone}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="roster-stat">
      <span className="roster-stat-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RosterRow({ member, now, onOpen }: { member: Member; now: number; onOpen: () => void }) {
  const expiresAt = member.membership_expires_at ? new Date(member.membership_expires_at) : null;
  const msLeft = msUntilExpiry(member, now);
  const expiryState = msLeft < 0 ? "is-expired" : msLeft < EXPIRY_WARNING_MS ? "is-soon" : "";

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  };

  return (
    <li className="roster-row is-openable" role="button" tabIndex={0} onClick={onOpen} onKeyDown={onKeyDown}>
      <strong className="roster-name">{member.full_name}</strong>
      {member.email ? (
        <span className="roster-email">{member.email}</span>
      ) : (
        <span className="roster-email is-missing">Not signed in yet</span>
      )}
      <MemberTags member={member} />
      <span className={`roster-expiry ${expiryState}`}>
        {expiresAt ? `${msLeft < 0 ? "Expired " : ""}${shortDate.format(expiresAt)}` : "End of year"}
      </span>
    </li>
  );
}

function MemberTags({ member }: { member: Member }) {
  return (
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
  );
}

interface Loan {
  id: string;
  quantity: number;
  start_date: string;
  end_date: string;
  status: "pending" | "approved";
  equipment: { name: string } | null;
}

function MemberSheet({
  member,
  viewer,
  now,
  onClose,
  onUpdated,
  onMessage,
}: {
  member: Member;
  viewer: RosterViewer;
  now: number;
  onClose: () => void;
  onUpdated: (memberId: string, patch: Partial<Member>) => void;
  onMessage: (toast: { tone: "success" | "error"; text: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const memberId = member.member_id;

  useEffect(() => {
    if (!memberId) return;
    const controller = new AbortController();
    fetch(`/api/admin/members/${memberId}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { loans: [] }))
      .then((data: { loans?: Loan[] }) => setLoans(data.loans ?? []))
      .catch(() => {
        if (!controller.signal.aborted) setLoans([]);
      });
    return () => controller.abort();
  }, [memberId]);

  const target = { id: memberId ?? "", governanceRole: member.governance_role };
  const leaderChange: RoleChange = { field: "is_walk_leader", value: !member.is_walk_leader };
  const committeeChange: RoleChange = {
    field: "governance_role",
    value: member.governance_role === "committee" ? null : "committee",
  };
  const canLeader = Boolean(memberId) && canChangeRole(viewer, target, leaderChange);
  const canCommittee = Boolean(memberId) && canChangeRole(viewer, target, committeeChange);

  async function send(body: Record<string, unknown>, done: string) {
    if (!memberId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save that change.");
      onUpdated(memberId, {
        governance_role: data.member.governance_role,
        is_walk_leader: data.member.is_walk_leader,
        governance_role_locked: data.member.governance_role_locked,
        walk_leader_locked: data.member.walk_leader_locked,
      });
      onMessage({ tone: "success", text: done });
    } catch (error) {
      onMessage({ tone: "error", text: error instanceof Error ? error.message : "Couldn't save that change." });
    } finally {
      setBusy(false);
    }
  }

  const expiresAt = member.membership_expires_at ? new Date(member.membership_expires_at) : null;
  const lastSeen = member.last_signed_in_at ? new Date(member.last_signed_in_at) : null;
  const firstName = member.full_name.split(" ")[0];

  return (
    <Sheet onClose={onClose} labelledBy="member-sheet">
      <h3 id="member-sheet">{member.full_name}</h3>
      {member.email && (
        <p>
          <a className="kit-request-email" href={`mailto:${member.email}`}>
            {member.email}
          </a>
        </p>
      )}
      <MemberTags member={member} />

      <dl className="member-facts">
        <div>
          <dt>Membership</dt>
          <dd>
            {MEMBERSHIP_LABELS[member.membership_tier]}
            {member.member_type ? ` · ${member.member_type}` : ""}
          </dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>
            {expiresAt
              ? `${expiresAt.getTime() < now ? "Expired " : ""}${shortDate.format(expiresAt)}`
              : "End of the club year"}
          </dd>
        </div>
        <div>
          <dt>Last signed in</dt>
          <dd>{lastSeen ? shortDate.format(lastSeen) : member.email ? "Before sign-ins were recorded" : "Never"}</dd>
        </div>
      </dl>

      <section className="member-section">
        <h4 className="event-eyebrow">Roles</h4>
        {!memberId ? (
          <p className="member-note">{firstName} needs to sign in once before they can be given a role.</p>
        ) : (
          <ul className="member-roles">
            <li>
              <span>
                <strong>Walk leader</strong>
                <small>{member.is_walk_leader ? "Can run walks and see day-of tools" : "Not a leader"}</small>
                {member.walk_leader_locked && <LockNote />}
              </span>
              {canLeader ? (
                <span className="member-role-actions">
                  {member.walk_leader_locked && (
                    <button
                      type="button"
                      className="kit-btn danger-text"
                      disabled={busy}
                      onClick={() => send({ unlock: "is_walk_leader" }, "Handed back to the member sync.")}
                    >
                      Return to sync
                    </button>
                  )}
                  <button
                    type="button"
                    className={`kit-btn${member.is_walk_leader ? "" : " primary"}`}
                    disabled={busy}
                    onClick={() =>
                      send(
                        { field: "is_walk_leader", value: !member.is_walk_leader },
                        member.is_walk_leader ? `${firstName} is no longer a walk leader.` : `${firstName} is now a walk leader.`,
                      )
                    }
                  >
                    {member.is_walk_leader ? "Remove" : "Make leader"}
                  </button>
                </span>
              ) : null}
            </li>
            <li>
              <span>
                <strong>Committee</strong>
                <small>
                  {member.governance_role
                    ? GOVERNANCE_LABELS[member.governance_role]
                    : "Not on the committee"}
                </small>
                {member.governance_role_locked && <LockNote />}
              </span>
              {canCommittee ? (
                <span className="member-role-actions">
                  {member.governance_role_locked && (
                    <button
                      type="button"
                      className="kit-btn danger-text"
                      disabled={busy}
                      onClick={() => send({ unlock: "governance_role" }, "Handed back to the member sync.")}
                    >
                      Return to sync
                    </button>
                  )}
                  <button
                    type="button"
                    className={`kit-btn${member.governance_role === "committee" ? " danger" : " primary"}`}
                    disabled={busy}
                    onClick={() =>
                      send(
                        { field: "governance_role", value: committeeChange.value },
                        committeeChange.value
                          ? `${firstName} is now on the committee.`
                          : `${firstName} has been removed from the committee.`,
                      )
                    }
                  >
                    {member.governance_role === "committee" ? "Remove" : "Add to committee"}
                  </button>
                </span>
              ) : (
                member.governance_role !== "principal" &&
                member.governance_role !== "admin" &&
                viewer.id !== memberId && <small className="member-note">Only a principal can change this.</small>
              )}
            </li>
          </ul>
        )}
      </section>

      {memberId && (
        <section className="member-section">
          <h4 className="event-eyebrow">Kit</h4>
          {loans === null ? (
            <p className="member-note">Loading…</p>
          ) : loans.length === 0 ? (
            <p className="member-note">Nothing borrowed or requested.</p>
          ) : (
            <ul className="member-loans">
              {loans.map((loan) => (
                <li key={loan.id}>
                  <strong>
                    {loan.quantity > 1 ? `${loan.quantity} × ` : ""}
                    {loan.equipment?.name ?? "Kit"}
                  </strong>
                  <span className={`kit-tag is-${loan.status}`}>{loan.status === "approved" ? "On loan" : "Pending"}</span>
                  <small>
                    {shortDate.format(new Date(loan.start_date))} – {shortDate.format(new Date(loan.end_date))}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="modal-actions">
        <button type="button" className="kit-btn" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

function LockNote() {
  return (
    <small className="member-lock">
      <Lock size={11} aria-hidden="true" /> Set by hand · the sync won&apos;t change it
    </small>
  );
}
