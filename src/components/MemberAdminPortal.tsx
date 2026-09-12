"use client";

import { useEffect, useState } from "react";
import { Search, Users, Shield, CheckCircle2, AlertCircle, Loader2, Filter } from "lucide-react";
import type { Member } from "@/lib/types";
import { CustomSelect, type SelectOption } from "./CustomSelect";

const TIER_OPTIONS: SelectOption[] = [
  { value: "", label: "All Tiers" },
  { value: "taster", label: "Taster Tier", color: "#f59e0b" },
  { value: "standard", label: "Standard Tier", color: "#0284c7" },
  { value: "explorer", label: "Explorer Tier", color: "#7c3aed" },
];

const ROLE_OPTIONS: SelectOption[] = [
  { value: "", label: "All Roles" },
  { value: "committee", label: "Committee", color: "#059669" },
  { value: "principal", label: "Principal", color: "#e11d48" },
  { value: "admin", label: "Admin", color: "#dc2626" },
  { value: "leader", label: "Walk Leaders Only", color: "#2563eb" },
];

interface MemberCounts {
  taster: number;
  standard: number;
  explorer: number;
  leaders: number;
}

export function MemberAdminPortal() {
  const [members, setMembers] = useState<Member[]>([]);
  const [counts, setCounts] = useState<MemberCounts>({ taster: 0, standard: 0, explorer: 0, leaders: 0 });
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (searchQuery) params.set("q", searchQuery);
      if (tierFilter) params.set("tier", tierFilter);
      if (roleFilter) params.set("role", roleFilter);

      fetch(`/api/admin/members?${params.toString()}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(res)))
        .then((data) => {
          if (!active) return;
          setMembers(data.members || []);
          if (data.counts) setCounts(data.counts);
          if (data.totalCount !== undefined) setTotalCount(data.totalCount);
        })
        .catch(() => {
          if (active) setError("Failed to fetch member directory");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, tierFilter, roleFilter]);

  return (
    <div className="equipment-portal-shell" style={{ marginTop: 24 }}>
      <div className="equipment-header">
        <div>
          <h2>Member Roster &amp; Access Administration</h2>
          <p>Live synced club membership records from Students&apos; Union UCL.</p>
        </div>
      </div>

      {/* KPI METRIC CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 22 }}>
        <div style={{ background: "white", padding: "16px 20px", borderRadius: 16, border: "1px solid var(--line)" }}>
          <small style={{ textTransform: "uppercase", fontSize: 10, fontWeight: 800, opacity: 0.6 }}>Total Synced</small>
          <div style={{ font: "800 24px var(--font-display)", color: "var(--ink)", marginTop: 4 }}>{totalCount}</div>
          <span style={{ fontSize: 11, opacity: 0.7 }}>Active club members</span>
        </div>
        <div style={{ background: "white", padding: "16px 20px", borderRadius: 16, border: "1px solid var(--line)" }}>
          <small style={{ textTransform: "uppercase", fontSize: 10, fontWeight: 800, color: "#0284c7" }}>Taster Members</small>
          <div style={{ font: "800 24px var(--font-display)", color: "#0369a1", marginTop: 4 }}>{counts.taster}</div>
          <span style={{ fontSize: 11, opacity: 0.7 }}>Free trial members</span>
        </div>
        <div style={{ background: "white", padding: "16px 20px", borderRadius: 16, border: "1px solid var(--line)" }}>
          <small style={{ textTransform: "uppercase", fontSize: 10, fontWeight: 800, color: "#ca8a04" }}>Standard Members</small>
          <div style={{ font: "800 24px var(--font-display)", color: "#854d0e", marginTop: 4 }}>{counts.standard}</div>
          <span style={{ fontSize: 11, opacity: 0.7 }}>Discoverer hikes &amp; socials</span>
        </div>
        <div style={{ background: "white", padding: "16px 20px", borderRadius: 16, border: "1px solid var(--line)" }}>
          <small style={{ textTransform: "uppercase", fontSize: 10, fontWeight: 800, color: "#dc2626" }}>Explorer Members</small>
          <div style={{ font: "800 24px var(--font-display)", color: "#991b1b", marginTop: 4 }}>{counts.explorer}</div>
          <span style={{ fontSize: 11, opacity: 0.7 }}>All hikes &amp; mountain trips</span>
        </div>
        <div style={{ background: "white", padding: "16px 20px", borderRadius: 16, border: "1px solid var(--line)" }}>
          <small style={{ textTransform: "uppercase", fontSize: 10, fontWeight: 800, color: "#16a34a" }}>Walk Leaders</small>
          <div style={{ font: "800 24px var(--font-display)", color: "#15803d", marginTop: 4 }}>{counts.leaders}</div>
          <span style={{ fontSize: 11, opacity: 0.7 }}>Qualified route leaders</span>
        </div>
      </div>

      {/* SEARCH AND FILTERS */}
      <div className="search-filter-bar">
        <div className="search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search by full name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <CustomSelect
          value={tierFilter}
          onChange={setTierFilter}
          options={TIER_OPTIONS}
          icon={<Filter size={14} />}
          variant="pill"
          ariaLabel="Filter members by membership tier"
        />
        <CustomSelect
          value={roleFilter}
          onChange={setRoleFilter}
          options={ROLE_OPTIONS}
          variant="pill"
          ariaLabel="Filter members by role"
        />
      </div>

      {error && (
        <div className="alert-banner error">
          <AlertCircle size={18} />
          <p>{error}</p>
        </div>
      )}

      {loading ? (
        <div className="sync-monitor-card loading">
          <Loader2 className="animate-spin" size={24} />
          <span>Searching members roster...</span>
        </div>
      ) : members.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", background: "white", borderRadius: 16 }}>
          <Users size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
          <p style={{ opacity: 0.7 }}>No club members match the current search filters.</p>
        </div>
      ) : (
        <div className="requests-table-wrapper">
          <table className="requests-table">
            <thead>
              <tr>
                <th>Member Name</th>
                <th>UCL Email</th>
                <th>Membership Tier</th>
                <th>Governance</th>
                <th>Walk Leader</th>
                <th>Expiry</th>
                <th>Last Synced</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.full_name || "Club Member"}</strong>
                  </td>
                  <td>{m.email}</td>
                  <td>
                    <span
                      className="category-badge"
                      style={{
                        background:
                          m.membership_tier === "explorer"
                            ? "#fee2e2"
                            : m.membership_tier === "standard"
                            ? "#fef9c3"
                            : "#e0f2fe",
                        color: "#1e293b",
                      }}
                    >
                      {m.membership_tier}
                    </span>
                  </td>
                  <td>
                    {m.governance_role ? (
                      <span className="condition-badge fair" style={{ textTransform: "capitalize" }}>
                        <Shield size={11} style={{ display: "inline", marginRight: 3, verticalAlign: "-1px" }} />
                        {m.governance_role}
                      </span>
                    ) : (
                      <span style={{ opacity: 0.4 }}>—</span>
                    )}
                  </td>
                  <td>
                    {m.is_walk_leader ? (
                      <span className="condition-badge excellent">
                        <CheckCircle2 size={11} style={{ display: "inline", marginRight: 3, verticalAlign: "-1px" }} />
                        Leader
                      </span>
                    ) : (
                      <span style={{ opacity: 0.4 }}>No</span>
                    )}
                  </td>
                  <td>
                    {m.membership_expires_at
                      ? new Date(m.membership_expires_at).toLocaleDateString("en-GB")
                      : "End of year"}
                  </td>
                  <td style={{ fontSize: 12, opacity: 0.7 }}>
                    {m.synced_at ? new Date(m.synced_at).toLocaleDateString("en-GB") : "Recently"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
