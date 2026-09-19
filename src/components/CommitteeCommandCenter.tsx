"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Shield,
  Crown,
  Compass,
  CalendarDays,
  Package,
  Users,
  RefreshCw,
  Key,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  AlertCircle,
  X,
  Check,
  Radio,
  Printer,
  UserCheck,
  SlidersHorizontal,
} from "lucide-react";
import type { Member, Walk, Equipment, EquipmentRequest, SUEvent } from "@/lib/types";
import { WalkCalendarPortal } from "./WalkCalendarPortal";
import { EquipmentPortal } from "./EquipmentPortal";
import { MemberAdminPortal } from "./MemberAdminPortal";
import { SUSessionManager } from "./SUSessionManager";

interface CommitteeCommandCenterProps {
  member: Member;
  isPrincipal: boolean;
  onSwitchToMemberView: () => void;
}

interface SyncRun {
  id: string;
  source: string;
  received_count: number;
  upserted_count: number;
  status?: string;
  started_at: string;
  completed_at: string;
}

interface SessionInfo {
  session_id: string | null;
  status: "active" | "expired" | "error" | "unconfigured";
  last_error: string | null;
  last_checked_at: string | null;
  updated_at?: string;
}

export function CommitteeCommandCenter({
  member,
  isPrincipal,
  onSwitchToMemberView,
}: CommitteeCommandCenterProps) {
  // Command Center Navigation
  const [activeTab, setActiveTab] = useState<"overview" | "walks" | "gear" | "roster" | "sync">("overview");

  // Live Operational Data
  const [walks, setWalks] = useState<Walk[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [requests, setRequests] = useState<EquipmentRequest[]>([]);
  const [events, setEvents] = useState<SUEvent[]>([]);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [memberSyncs, setMemberSyncs] = useState<SyncRun[]>([]);
  const [eventSyncs, setEventSyncs] = useState<SyncRun[]>([]);
  const [memberCounts, setMemberCounts] = useState({ total: 0, taster: 0, standard: 0, explorer: 0, leaders: 0 });
  const [loading, setLoading] = useState(true);

  // Quick Action States
  const [syncingTarget, setSyncingTarget] = useState<string | null>(null);
  const [syncSocietyGroup, setSyncSocietyGroup] = useState<string>("Hiking Club");
  const [syncMessage, setSyncMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [selectedWalkForManifest, setSelectedWalkForManifest] = useState<Walk | null>(null);
  const [walkAttendees, setWalkAttendees] = useState<Array<{ member_id: string; status: string; created_at: string; member: Member }>>([]);
  const [loadingAttendees, setLoadingAttendees] = useState(false);

  // In-line Gear Triage Action State
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const fetchCommandData = useCallback(async () => {
    try {
      const [wRes, eqRes, reqRes, evRes, syncRes, memRes] = await Promise.all([
        fetch("/api/walks"),
        fetch("/api/equipment"),
        fetch("/api/equipment/requests"),
        fetch("/api/events"),
        fetch("/api/sync/session-status"),
        fetch("/api/admin/members"),
      ]);

      if (wRes.ok) {
        const d = await wRes.json();
        setWalks(d.walks || []);
      }
      if (eqRes.ok) {
        const d = await eqRes.json();
        setEquipment(d.equipment || []);
      }
      if (reqRes.ok) {
        const d = await reqRes.json();
        setRequests(d.requests || []);
      }
      if (evRes.ok) {
        const d = await evRes.json();
        setEvents(d.events || []);
      }
      if (syncRes.ok) {
        const d = await syncRes.json();
        setSession(d.session || null);
        setMemberSyncs(d.memberSyncs || []);
        setEventSyncs(d.eventSyncs || []);
      }
      if (memRes.ok) {
        const d = await memRes.json();
        if (d.counts) {
          setMemberCounts({
            total: d.totalCount || 0,
            taster: d.counts.taster || 0,
            standard: d.counts.standard || 0,
            explorer: d.counts.explorer || 0,
            leaders: d.counts.leaders || 0,
          });
        }
      }
    } catch {
      // safe fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!active) return;
      await fetchCommandData();
    };
    run();
    const interval = setInterval(run, 30000); // 30s auto-refresh for command center
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [fetchCommandData]);

  // Quick In-line Equipment Approval/Rejection
  const handleQuickRequestAction = async (requestId: string, newStatus: "approved" | "rejected") => {
    setActionLoadingId(requestId);
    try {
      const res = await fetch(`/api/equipment/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, notes: `Reviewed via Officer Command Center` }),
      });
      if (res.ok) {
        setRequests((prev) =>
          prev.map((r) => (r.id === requestId ? { ...r, status: newStatus, notes: "Reviewed via Officer Command Center" } : r))
        );
      }
    } catch {
      // error handling
    } finally {
      setActionLoadingId(null);
    }
  };

  // Quick Trigger Sync
  const handleTriggerSync = async (target: "members" | "events" | "all") => {
    setSyncingTarget(target);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/sync/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          group: syncSocietyGroup.trim() || "Hiking Club",
        }),
      });
      const d = await res.json();
      if (res.ok) {
        setSyncMessage({ type: "success", text: d.message || `Refreshed ${target}` });
        await fetchCommandData();
      } else {
        setSyncMessage({ type: "error", text: d.error || "Sync failed" });
      }
    } catch {
      setSyncMessage({ type: "error", text: "Network error triggering sync" });
    } finally {
      setSyncingTarget(null);
    }
  };

  // Inspect Walk Attendee Manifest
  const handleOpenWalkManifest = async (walk: Walk) => {
    setSelectedWalkForManifest(walk);
    setLoadingAttendees(true);
    try {
      const res = await fetch(`/api/walks/${walk.id}/attendees`);
      if (res.ok) {
        const d = await res.json();
        setWalkAttendees(d.attendees || []);
      }
    } catch {
      setWalkAttendees([]);
    } finally {
      setLoadingAttendees(false);
    }
  };

  // Derived Operational Metrics
  const pendingRequests = useMemo(() => requests.filter((r) => r.status === "pending"), [requests]);
  const activeLoans = useMemo(() => requests.filter((r) => r.status === "approved"), [requests]);
  const upcomingWalks = useMemo(
    () => walks.filter((w) => new Date(w.starts_at) >= new Date()).slice(0, 4),
    [walks]
  );

  const isSessionExpired = session?.status === "expired" || session?.status === "error";

  return (
    <div className="command-center-container">
      {/* 1. TOP OFFICER BANNER & RADAR */}
      <header className="officer-top-bar">
        <div className="officer-identity">
          <div className="officer-badge-wrapper">
            <span className={`officer-role-pill ${isPrincipal ? "principal" : "committee"}`}>
              {isPrincipal ? <Crown size={14} /> : <Shield size={14} />}
              <span>{isPrincipal ? "Principal Officer" : "Committee Executive"}</span>
            </span>
            <span className="officer-name">{member.full_name || "Committee Member"}</span>
          </div>
          <p className="officer-tagline">
            {loading ? "Refreshing live radar telemetry..." : "UCL Hiking Club Governance & Operations Cockpit · Connected to Students' Union UCL"}
          </p>
        </div>

        <div className="officer-actions-group">
          <button
            type="button"
            onClick={onSwitchToMemberView}
            className="switch-view-btn"
            title="Switch to your personal member view"
          >
            <Compass size={15} />
            <span>Switch to Member View</span>
          </button>

          {isPrincipal && (
            <button
              type="button"
              onClick={() => setShowSessionModal(true)}
              className={`session-key-btn ${isSessionExpired ? "alert" : ""}`}
            >
              <Key size={15} />
              <span>{isSessionExpired ? "Fix SU Session" : "SU Session Key"}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => handleTriggerSync("all")}
            disabled={Boolean(syncingTarget)}
            className="sync-action-btn"
          >
            <RefreshCw size={14} className={syncingTarget ? "animate-spin" : ""} />
            <span>{syncingTarget ? "Syncing..." : "Sync Union"}</span>
          </button>
        </div>
      </header>

      {/* 2. URGENT OPERATIONAL ALERTS & NOTICES */}
      {isSessionExpired && (
        <div className="operational-alert-banner error">
          <div className="alert-content">
            <AlertTriangle size={20} className="alert-icon" />
            <div>
              <strong>Students&apos; Union Portal Session Expired</strong>
              <p>
                The automated hourly sync cannot pull fresh member purchases or official union tickets until a Principal
                Officer updates the session cookie.
              </p>
            </div>
          </div>
          {isPrincipal ? (
            <button
              type="button"
              onClick={() => setShowSessionModal(true)}
              className="alert-cta-btn error"
            >
              Update Session Token Now
            </button>
          ) : (
            <span className="alert-notice-chip">Requires Principal Officer</span>
          )}
        </div>
      )}

      {syncMessage && (
        <div className={`operational-alert-banner ${syncMessage.type}`}>
          <div className="alert-content">
            {syncMessage.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{syncMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setSyncMessage(null)}
            className="alert-dismiss-btn"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* 3. EXECUTIVE KPI METRICS RADAR */}
      <div className="officer-metrics-grid">
        {/* Active Members Metric */}
        <div
          onClick={() => setActiveTab("roster")}
          className={`officer-metric-box ${activeTab === "roster" ? "active" : ""}`}
        >
          <div className="metric-box-top">
            <span className="metric-label">Club Membership</span>
            <div className="metric-icon-bubble" style={{ background: "var(--info-bg)", color: "var(--info-fg)" }}>
              <Users size={18} />
            </div>
          </div>
          <div className="metric-primary-val">{memberCounts.total}</div>
          <div className="metric-breakdown-row">
            <span>{memberCounts.explorer} Explorer</span>
            <span>·</span>
            <span>{memberCounts.standard} Standard</span>
            <span>·</span>
            <span>{memberCounts.taster} Taster</span>
          </div>
          <div className="metric-footer-action">
            <span>Inspect Full Member Roster</span>
            <ArrowRight size={12} />
          </div>
        </div>

        {/* Walk Operations Metric */}
        <div
          onClick={() => setActiveTab("walks")}
          className={`officer-metric-box ${activeTab === "walks" ? "active" : ""}`}
        >
          <div className="metric-box-top">
            <span className="metric-label">Hike Schedule &amp; Trips</span>
            <div className="metric-icon-bubble" style={{ background: "var(--ok-bg)", color: "#059669" }}>
              <Compass size={18} />
            </div>
          </div>
          <div className="metric-primary-val">{upcomingWalks.length} Upcoming</div>
          <div className="metric-breakdown-row">
            <span>{memberCounts.leaders} Certified Leaders</span>
            <span>·</span>
            <span>{walks.length} Total Routes</span>
          </div>
          <div className="metric-footer-action">
            <span>Manage Walks &amp; Attendees</span>
            <ArrowRight size={12} />
          </div>
        </div>

        {/* Gear Locker & Requests Metric */}
        <div
          onClick={() => setActiveTab("gear")}
          className={`officer-metric-box ${activeTab === "gear" ? "active" : ""}`}
        >
          <div className="metric-box-top">
            <span className="metric-label">Gear Locker &amp; Loans</span>
            <div className="metric-icon-bubble" style={{ background: "var(--warn-bg)", color: "#d97706" }}>
              <Package size={18} />
            </div>
          </div>
          <div className="metric-primary-val" style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span>{equipment.length} Items</span>
            {pendingRequests.length > 0 && (
              <span className="metric-urgent-badge">{pendingRequests.length} Pending</span>
            )}
          </div>
          <div className="metric-breakdown-row">
            <span>{activeLoans.length} Loans in Field</span>
            <span>·</span>
            <span>{equipment.filter((e) => e.condition === "needs_repair").length} In Repair</span>
          </div>
          <div className="metric-footer-action">
            <span>Review Requests &amp; Stock</span>
            <ArrowRight size={12} />
          </div>
        </div>

        {/* SU Automation Status Metric */}
        <div
          onClick={() => setActiveTab("sync")}
          className={`officer-metric-box ${activeTab === "sync" ? "active" : ""}`}
        >
          <div className="metric-box-top">
            <span className="metric-label">SU Sync &amp; Session</span>
            <div className="metric-icon-bubble" style={{ background: "#f5f3ff", color: "#7c3aed" }}>
              <Radio size={18} />
            </div>
          </div>
          <div className="metric-primary-val" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`status-dot ${session?.status || "unconfigured"}`} />
            <span style={{ fontSize: 20, textTransform: "capitalize" }}>{session?.status || "Checking"}</span>
          </div>
          <div className="metric-breakdown-row">
            <span>
              {session?.last_checked_at
                ? `Checked ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(session.last_checked_at))}`
                : "No sync record"}
            </span>
            <span>·</span>
            <span>Hourly Auto-Worker</span>
          </div>
          <div className="metric-footer-action">
            <span>Open SU Session Center</span>
            <ArrowRight size={12} />
          </div>
        </div>
      </div>

      {/* 4. WORKSPACE TAB SELECTOR */}
      <nav className="command-tabs-nav" aria-label="Officer Workspace navigation">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`command-tab-item ${activeTab === "overview" ? "active" : ""}`}
        >
          <SlidersHorizontal size={16} />
          <span>Operations Cockpit</span>
          {pendingRequests.length > 0 && (
            <span className="command-tab-badge alert">{pendingRequests.length}</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("walks")}
          className={`command-tab-item ${activeTab === "walks" ? "active" : ""}`}
        >
          <Compass size={16} />
          <span>Walk Operations &amp; Rosters</span>
          <span className="command-tab-badge">{walks.length}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("gear")}
          className={`command-tab-item ${activeTab === "gear" ? "active" : ""}`}
        >
          <Package size={16} />
          <span>Gear Locker &amp; Approvals</span>
          {pendingRequests.length > 0 && (
            <span className="command-tab-badge alert">{pendingRequests.length}</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("roster")}
          className={`command-tab-item ${activeTab === "roster" ? "active" : ""}`}
        >
          <Users size={16} />
          <span>Member Directory &amp; Roles</span>
          <span className="command-tab-badge">{memberCounts.total}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("sync")}
          className={`command-tab-item ${activeTab === "sync" ? "active" : ""}`}
        >
          <Shield size={16} />
          <span>SU Portal Session &amp; Sync</span>
          {isSessionExpired && <span className="command-tab-badge alert">!</span>}
        </button>
      </nav>

      {/* 5. WORKSPACE VIEWS */}
      <div className="command-content-view">
        {/* VIEW 1: OPERATIONS COCKPIT (TRIAGE & IMMEDIATE ACTIONS) */}
        {activeTab === "overview" && (
          <div className="cockpit-grid">
            {/* LEFT COLUMN: URGENT TRIAGE INBOX */}
            <div className="cockpit-column-main">
              {/* PENDING GEAR REQUESTS ACTION CARD */}
              <div className="command-section-card">
                <div className="card-header-row">
                  <div>
                    <h3>
                      Equipment Review Queue
                      {pendingRequests.length > 0 && (
                        <span className="queue-pill">{pendingRequests.length} Pending Decision</span>
                      )}
                    </h3>
                    <p>Review student gear loan requests for upcoming expeditions and weekend hikes.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("gear")}
                    className="card-header-link"
                  >
                    <span>Full Locker</span>
                    <ArrowRight size={14} />
                  </button>
                </div>

                {pendingRequests.length === 0 ? (
                  <div className="cockpit-empty-state">
                    <CheckCircle2 size={32} color="#16a34a" />
                    <div>
                      <strong>All Equipment Requests Handled</strong>
                      <p>No student loan requests are currently awaiting committee review.</p>
                    </div>
                  </div>
                ) : (
                  <div className="triage-requests-list">
                    {pendingRequests.map((req) => (
                      <div key={req.id} className="triage-request-card">
                        <div className="triage-request-meta">
                          <div className="requester-info">
                            <strong>{req.member?.full_name || "Club Member"}</strong>
                            <span className="requester-tier-tag">
                              {req.member?.membership_tier || "standard"} member
                            </span>
                            <span className="requester-email">{req.member?.email}</span>
                          </div>
                          <div className="request-kit-summary">
                            <strong>
                              {req.quantity}x {req.equipment?.name || "Equipment item"}
                            </strong>
                            <span className="dates-pill">
                              <CalendarDays size={12} />
                              <span>
                                {req.start_date} to {req.end_date}
                              </span>
                            </span>
                          </div>
                        </div>

                        {req.purpose && (
                          <div className="triage-purpose-box">
                            <span className="purpose-label">Purpose:</span> &quot;{req.purpose}&quot;
                          </div>
                        )}

                        <div className="triage-actions-bar">
                          <button
                            type="button"
                            disabled={actionLoadingId === req.id}
                            onClick={() => handleQuickRequestAction(req.id, "approved")}
                            className="triage-btn approve"
                          >
                            <Check size={14} />
                            <span>Approve Loan</span>
                          </button>
                          <button
                            type="button"
                            disabled={actionLoadingId === req.id}
                            onClick={() => handleQuickRequestAction(req.id, "rejected")}
                            className="triage-btn reject"
                          >
                            <X size={14} />
                            <span>Decline</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* UPCOMING HIKES & MANIFEST ACCESS CARD */}
              <div className="command-section-card" style={{ marginTop: 24 }}>
                <div className="card-header-row">
                  <div>
                    <h3>Upcoming Hikes &amp; Leader Manifests</h3>
                    <p>Access live hiker attendance lists, emergency contacts, and route capacity.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("walks")}
                    className="card-header-link"
                  >
                    <span>Manage All Walks</span>
                    <ArrowRight size={14} />
                  </button>
                </div>

                <div className="cockpit-walks-grid">
                  {upcomingWalks.map((walk) => {
                    const booked = walk.capacity - walk.spaces_remaining;
                    const fillPercent = Math.min(100, Math.round((booked / walk.capacity) * 100));

                    return (
                      <div key={walk.id} className="cockpit-walk-row">
                        <div className="cockpit-walk-main">
                          <div className="cockpit-walk-heading">
                            <h4>{walk.title}</h4>
                            <span className={`difficulty-chip ${walk.difficulty}`}>{walk.difficulty}</span>
                          </div>
                          <div className="cockpit-walk-sub">
                            <span>
                              <CalendarDays size={13} />
                              {new Intl.DateTimeFormat("en-GB", {
                                weekday: "short",
                                day: "numeric",
                                month: "short",
                              }).format(new Date(walk.starts_at))}
                            </span>
                            <span>·</span>
                            <span>Leader: {walk.leader?.full_name || "Unassigned"}</span>
                            <span>·</span>
                            <span>{walk.location}</span>
                          </div>
                        </div>

                        <div className="cockpit-walk-capacity">
                          <div className="capacity-text">
                            <strong>{booked}</strong> / {walk.capacity} Booked ({fillPercent}%)
                          </div>
                          <div className="capacity-track">
                            <div className="capacity-fill" style={{ width: `${fillPercent}%` }} />
                          </div>
                        </div>

                        <div className="cockpit-walk-cta">
                          <button
                            type="button"
                            onClick={() => handleOpenWalkManifest(walk)}
                            className="manifest-btn"
                          >
                            <UserCheck size={14} />
                            <span>Hiker Roster</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: EXECUTIVE QUICK ACTIONS & HEALTH */}
            <div className="cockpit-column-sidebar">
              {/* PRINCIPAL SESSION STATUS BOX */}
              <div className="sidebar-control-card">
                <div className="sidebar-card-header">
                  <Key size={16} />
                  <h4>Students&apos; Union Session</h4>
                </div>
                <div className="session-status-display">
                  <div className="status-indicator-row">
                    <span className={`status-pill ${session?.status || "unconfigured"}`}>
                      {session?.status || "Unconfigured"}
                    </span>
                    <small>
                      {session?.last_checked_at
                        ? `Checked ${new Intl.DateTimeFormat("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(session.last_checked_at))}`
                        : "No check record"}
                    </small>
                  </div>
                  <p className="session-explanation">
                    Provides authenticated access to scrape official SU society rosters and ticketing systems.
                  </p>
                </div>

                {isPrincipal ? (
                  <button
                    type="button"
                    onClick={() => setShowSessionModal(true)}
                    className="sidebar-action-btn primary"
                  >
                    <span>Update Portal Session Token</span>
                    <ArrowRight size={14} />
                  </button>
                ) : (
                  <div className="role-lock-notice">
                    <span>Session updates restricted to Principal Officers (President, Treasurer, Secretary).</span>
                  </div>
                )}
              </div>

              {/* QUICK SYNC DISPATCH BOX */}
              <div className="sidebar-control-card" style={{ marginTop: 18 }}>
                <div className="sidebar-card-header">
                  <RefreshCw size={16} />
                  <h4>On-Demand Sync Operations</h4>
                </div>
                <p style={{ fontSize: 12, opacity: 0.7, margin: "0 0 14px", lineHeight: 1.5 }}>
                  Trigger immediate synchronisation from official union feeds to refresh active subscriptions.
                </p>

                <div className="sync-buttons-stack">
                  <button
                    type="button"
                    disabled={Boolean(syncingTarget)}
                    onClick={() => handleTriggerSync("members")}
                    className="sync-tool-btn"
                  >
                    <span>Sync Member Roster</span>
                    {syncingTarget === "members" ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <ArrowRight size={14} />
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={Boolean(syncingTarget)}
                    onClick={() => handleTriggerSync("events")}
                    className="sync-tool-btn"
                  >
                    <span>Sync SU Union Events</span>
                    {syncingTarget === "events" ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <ArrowRight size={14} />
                    )}
                  </button>
                </div>
              </div>

              {/* RECENT SYNC AUDIT TRAIL */}
              <div className="sidebar-control-card" style={{ marginTop: 18 }}>
                <div className="sidebar-card-header">
                  <Clock size={16} />
                  <h4>Recent Sync Log</h4>
                </div>
                <div className="sync-audit-list">
                  {memberSyncs.slice(0, 3).map((run) => (
                    <div key={run.id} className="sync-audit-row">
                      <div className="audit-row-left">
                        <CheckCircle2 size={13} color="#16a34a" />
                        <span>Roster Sync</span>
                      </div>
                      <span className="audit-count">+{run.upserted_count} updated</span>
                      <small className="audit-time">
                        {new Intl.DateTimeFormat("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(run.completed_at))}
                      </small>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: FULL WALK OPERATIONS PORTAL */}
        {activeTab === "walks" && (
          <div>
            <WalkCalendarPortal
              memberId={member.id}
              membershipTier={member.membership_tier}
              isWalkLeader={true}
              isCommittee={true}
              initialTab="leader"
            />
          </div>
        )}

        {/* VIEW 3: EQUIPMENT & LOCKER PORTAL */}
        {activeTab === "gear" && (
          <div>
            <EquipmentPortal
              memberId={member.id}
              isPrincipal={true}
              initialTab="committee_review"
            />
          </div>
        )}

        {/* VIEW 4: MEMBER ROSTER ADMINISTRATION */}
        {activeTab === "roster" && (
          <div>
            <MemberAdminPortal />
          </div>
        )}

        {/* VIEW 5: SU SYNC & SESSION SUITE */}
        {activeTab === "sync" && (
          <div className="command-sync-suite">
            <div className="command-section-card">
              <div className="card-header-row">
                <div>
                  <h2>Students&apos; Union UCL Automation &amp; Session Suite</h2>
                  <p>
                    Manage authentication credentials, monitor hourly Cloud Run sync jobs, and view membership ingestion logs.
                  </p>
                </div>
              </div>

              <div style={{ marginTop: 20 }}>
                <SUSessionManager
                  currentStatus={session?.status || "unconfigured"}
                  onSaved={fetchCommandData}
                />
              </div>

              <div style={{ marginTop: 24 }}>
                <h4 style={{ margin: "0 0 14px", font: "800 16px var(--font-display)" }}>
                  Trigger Manual Synchronization
                </h4>

                <div style={{ marginBottom: 16, padding: "14px", background: "var(--color-surface, #f8fafc)", borderRadius: 10, border: "1px solid var(--color-border, #e2e8f0)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                    <label style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text, #0f172a)", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>Target Society / Club to Sync:</span>
                      {syncSocietyGroup !== "Hiking Club" && (
                        <span style={{ fontSize: 11, background: "var(--warn-bg)", color: "var(--warn-fg)", padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>
                          Custom Society Testing
                        </span>
                      )}
                    </label>
                    {syncSocietyGroup !== "Hiking Club" && (
                      <button
                        type="button"
                        onClick={() => setSyncSocietyGroup("Hiking Club")}
                        style={{ fontSize: 11, padding: "4px 8px", background: "none", border: "1px solid var(--line-strong)", borderRadius: 6, cursor: "pointer" }}
                      >
                        Reset to Hiking Club
                      </button>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="text"
                      value={syncSocietyGroup}
                      onChange={(e) => setSyncSocietyGroup(e.target.value)}
                      placeholder="e.g. Hiking Club, Barbell Club, or group slug"
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        fontSize: 13,
                        borderRadius: 6,
                        border: "1px solid var(--color-border, #cbd5e0)",
                        background: "var(--color-bg, #ffffff)",
                        color: "inherit",
                      }}
                    />
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, opacity: 0.75, lineHeight: 1.4 }}>
                    💡 To test seeding members from another club or society you have committee access to, type the society name or web slug (e.g. <code>barbell-club</code> or <code>Barbell Club</code>) and click refresh below.
                  </div>
                </div>

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={Boolean(syncingTarget)}
                    onClick={() => handleTriggerSync("all")}
                    className="button primary compact"
                  >
                    <RefreshCw size={14} className={syncingTarget ? "animate-spin" : ""} />
                    <span>{syncingTarget ? "Syncing..." : "Sync All (Members & Events)"}</span>
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(syncingTarget)}
                    onClick={() => handleTriggerSync("members")}
                    className="button compact"
                  >
                    <span>Members Only</span>
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(syncingTarget)}
                    onClick={() => handleTriggerSync("events")}
                    className="button compact"
                  >
                    <span>Events Only ({events.length} tracked)</span>
                  </button>
                  {eventSyncs.length > 0 && (
                    <span style={{ fontSize: 12, opacity: 0.6, alignSelf: "center" }}>
                      {eventSyncs.length} event sync log{eventSyncs.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 32 }}>
                <h4 style={{ margin: "0 0 14px", font: "800 16px var(--font-display)" }}>
                  Recent Member Ingestion Runs
                </h4>
                <div className="requests-table-wrapper">
                  <table className="requests-table">
                    <thead>
                      <tr>
                        <th>Run ID</th>
                        <th>Source</th>
                        <th>Received Rows</th>
                        <th>Upserted Rows</th>
                        <th>Started</th>
                        <th>Completed</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {memberSyncs.map((run) => (
                        <tr key={run.id}>
                          <td style={{ fontFamily: "monospace", fontSize: 11 }}>{run.id}</td>
                          <td>{run.source}</td>
                          <td><strong>{run.received_count}</strong></td>
                          <td><strong>{run.upserted_count}</strong></td>
                          <td style={{ fontSize: 11, opacity: 0.7 }}>
                            {new Date(run.started_at).toLocaleTimeString()}
                          </td>
                          <td style={{ fontSize: 11, opacity: 0.7 }}>
                            {new Date(run.completed_at).toLocaleTimeString()}
                          </td>
                          <td>
                            <span className="req-status approved">Success</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 6. MODAL: WALK ATTENDEE & SAFETY MANIFEST */}
      {selectedWalkForManifest && (
        <div className="modal-overlay" onClick={() => setSelectedWalkForManifest(null)}>
          <div
            className="modal-card"
            style={{ maxWidth: 680, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="manifest-modal-header">
              <div>
                <span className="manifest-eyebrow">Official Trail Manifest</span>
                <h3>{selectedWalkForManifest.title}</h3>
                <p>
                  {selectedWalkForManifest.location} ·{" "}
                  {new Intl.DateTimeFormat("en-GB", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }).format(new Date(selectedWalkForManifest.starts_at))}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedWalkForManifest(null)}
                className="close-modal-btn"
              >
                <X size={18} />
              </button>
            </div>

            <div className="manifest-stats-strip">
              <div>
                <small>Confirmed Hikers</small>
                <strong>{walkAttendees.filter((a) => a.status === "confirmed").length}</strong>
              </div>
              <div>
                <small>Waitlist</small>
                <strong>{walkAttendees.filter((a) => a.status === "waitlist").length}</strong>
              </div>
              <div>
                <small>Capacity</small>
                <strong>{selectedWalkForManifest.capacity}</strong>
              </div>
              <div>
                <small>Leader</small>
                <strong>{selectedWalkForManifest.leader?.full_name || "Assigned"}</strong>
              </div>
            </div>

            {loadingAttendees ? (
              <div style={{ padding: "32px 0", textAlign: "center", opacity: 0.6 }}>
                Loading attendee roster...
              </div>
            ) : walkAttendees.length === 0 ? (
              <div style={{ padding: "32px 0", textAlign: "center", opacity: 0.6 }}>
                No hikers have registered for this walk yet.
              </div>
            ) : (
              <div className="manifest-table-wrapper" style={{ maxHeight: 360, overflowY: "auto", margin: "16px 0" }}>
                <table className="requests-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Hiker Name</th>
                      <th>Student Email</th>
                      <th>Tier</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {walkAttendees.map((att, idx) => (
                      <tr key={att.member_id}>
                        <td style={{ opacity: 0.5, fontSize: 11 }}>{idx + 1}</td>
                        <td>
                          <strong>{att.member.full_name || "Hiker"}</strong>
                        </td>
                        <td style={{ fontSize: 12 }}>{att.member.email}</td>
                        <td>
                          <span className="preset-pill-tag">
                            {att.member.membership_tier}
                          </span>
                        </td>
                        <td>
                          <span className={`req-status ${att.status === "confirmed" ? "approved" : "pending"}`}>
                            {att.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="modal-actions" style={{ justifyContent: "space-between" }}>
              <button
                type="button"
                onClick={() => window.print()}
                className="button compact"
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Printer size={14} />
                <span>Print Trail Manifest</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedWalkForManifest(null)}
                className="button primary compact"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. MODAL: PRINCIPAL SU SESSION MANAGER */}
      {showSessionModal && (
        <div className="modal-overlay" onClick={() => setShowSessionModal(false)}>
          <div
            className="modal-card"
            style={{ maxWidth: 540 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <span className="manifest-eyebrow" style={{ color: "#d97706" }}>Principal Authority</span>
                <h3 style={{ margin: "2px 0 0" }}>Update SU Portal Session</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSessionModal(false)}
                className="close-modal-btn"
              >
                <X size={18} />
              </button>
            </div>

            <SUSessionManager
              currentStatus={session?.status || "unconfigured"}
              onSaved={() => {
                setShowSessionModal(false);
                fetchCommandData();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
