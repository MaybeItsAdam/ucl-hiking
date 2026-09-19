"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert, Users, CalendarDays, Key } from "lucide-react";
import { SUSessionManager } from "./SUSessionManager";

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

export function SyncMonitor({ isPrincipal }: { isPrincipal: boolean }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [memberSyncs, setMemberSyncs] = useState<SyncRun[]>([]);
  const [eventSyncs, setEventSyncs] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingTarget, setSyncingTarget] = useState<string | null>(null);
  const [societyGroup, setSocietyGroup] = useState<string>("Hiking Club");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showSessionManager, setShowSessionManager] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/sync/session-status");
      if (res.ok) {
        const data = await res.json();
        setSession(data.session);
        setMemberSyncs(data.memberSyncs || []);
        setEventSyncs(data.eventSyncs || []);
      }
    } catch {
      setMessage({ type: "error", text: "Failed to load sync status" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetch("/api/sync/session-status")
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => {
        if (!active) return;
        setSession(data.session);
        setMemberSyncs(data.memberSyncs || []);
        setEventSyncs(data.eventSyncs || []);
      })
      .catch(() => {
        if (active) setMessage({ type: "error", text: "Failed to load sync status" });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleTriggerSync = async (target: "members" | "events" | "all") => {
    setSyncingTarget(target);
    setMessage(null);
    try {
      const res = await fetch("/api/sync/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          group: societyGroup.trim() || "Hiking Club",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.sessionExpired) {
          setMessage({
            type: "error",
            text: "SU session has expired! A Principal member must update the session token.",
          });
        } else {
          setMessage({ type: "error", text: data.error || "Sync execution failed" });
        }
      } else {
        setMessage({ type: "success", text: data.message || `Successfully refreshed ${target}.` });
      }
      await fetchStatus();
    } catch {
      setMessage({ type: "error", text: "Network error triggering sync." });
    } finally {
      setSyncingTarget(null);
    }
  };

  if (loading) {
    return (
      <div className="sync-monitor-card loading">
        <RefreshCw className="animate-spin" size={24} />
        <span>Loading sync monitor...</span>
      </div>
    );
  }

  const isExpired = session?.status === "expired";
  const lastMemberSync = memberSyncs[0];
  const lastEventSync = eventSyncs[0];

  return (
    <div className="sync-monitor-card">
      <div className="sync-monitor-header">
        <div>
          <h3>SU Roster & Event Sync Monitor</h3>
          <p>Automated daily sync &amp; manual committee refresh for members &amp; events</p>
        </div>
        <div className="status-badge-container">
          <span className={`status-badge ${session?.status || "unconfigured"}`}>
            {isExpired ? (
              <>
                <AlertTriangle size={14} /> Session Expired
              </>
            ) : session?.status === "active" ? (
              <>
                <CheckCircle2 size={14} /> Session Active
              </>
            ) : (
              <>
                <ShieldAlert size={14} /> {session?.status || "Unconfigured"}
              </>
            )}
          </span>
          {isPrincipal && (
            <button
              onClick={() => setShowSessionManager(!showSessionManager)}
              className="button-link text-sm"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700 }}
            >
              <Key size={13} /> {showSessionManager ? "Close Session Settings" : "Update SU Session"}
            </button>
          )}
        </div>
      </div>

      {isExpired && (
        <div className="alert-banner warning">
          <AlertTriangle size={18} />
          <div>
            <strong>SU Session Expired</strong>
            <p>
              The SU portal authentication session has expired. Automatic daily syncs are paused.
              {isPrincipal ? " Click 'Update SU Session' above to input a new session token." : " Please contact a Principal committee member (President/Treasurer) to update the session in settings."}
            </p>
            {session?.last_error && <small className="error-detail">Log: {session.last_error}</small>}
          </div>
        </div>
      )}

      {message && (
        <div className={`alert-banner ${message.type}`}>
          {message.type === "success" ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}
          <span>{message.text}</span>
        </div>
      )}

      {showSessionManager && isPrincipal && (
        <div className="session-manager-wrapper">
          <SUSessionManager
            currentStatus={session?.status || "unconfigured"}
            onSaved={() => {
              setShowSessionManager(false);
              fetchStatus();
            }}
          />
        </div>
      )}

      <div style={{ margin: "16px 0", padding: "14px", background: "var(--color-surface, #f8fafc)", borderRadius: 10, border: "1px solid var(--color-border, #e2e8f0)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text, #0f172a)", display: "flex", alignItems: "center", gap: 6 }}>
            <span>Target Society / Club to Sync:</span>
            {societyGroup !== "Hiking Club" && (
              <span style={{ fontSize: 11, background: "var(--warn-bg)", color: "var(--warn-fg)", padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>
                Custom Society Testing
              </span>
            )}
          </label>
          {societyGroup !== "Hiking Club" && (
            <button
              type="button"
              onClick={() => setSocietyGroup("Hiking Club")}
              style={{ fontSize: 11, padding: "4px 8px", background: "none", border: "1px solid var(--line-strong)", borderRadius: 6, cursor: "pointer" }}
            >
              Reset to Hiking Club
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            value={societyGroup}
            onChange={(e) => setSocietyGroup(e.target.value)}
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
          💡 To test seeding members from another club or society you have committee access to, type the society name or URL slug (e.g. <code>barbell-club</code> or <code>Barbell Club</code>) and click refresh below.
        </div>
      </div>

      <div className="sync-monitor-actions">
        <button
          disabled={syncingTarget !== null || isExpired}
          onClick={() => handleTriggerSync("members")}
          className="button primary compact"
          style={{ cursor: syncingTarget || isExpired ? "not-allowed" : "pointer" }}
        >
          <Users size={16} />
          {syncingTarget === "members" ? "Refreshing Members..." : "Refresh Members Now"}
        </button>

        <button
          disabled={syncingTarget !== null || isExpired}
          onClick={() => handleTriggerSync("events")}
          className="button compact"
          style={{ cursor: syncingTarget || isExpired ? "not-allowed" : "pointer" }}
        >
          <CalendarDays size={16} />
          {syncingTarget === "events" ? "Refreshing Events..." : "Refresh Events Now"}
        </button>

        <button
          disabled={syncingTarget !== null || isExpired}
          onClick={() => handleTriggerSync("all")}
          className="button compact"
          style={{ cursor: syncingTarget || isExpired ? "not-allowed" : "pointer" }}
        >
          <RefreshCw size={16} className={syncingTarget === "all" ? "animate-spin" : ""} />
          {syncingTarget === "all" ? "Refreshing All..." : "Refresh All"}
        </button>
      </div>

      <div className="sync-history-grid">
        <div className="sync-history-box">
          <h4>Member Sync Roster</h4>
          {lastMemberSync ? (
            <div className="sync-stats">
              <div>
                <small>Last Run</small>
                <strong>{new Date(lastMemberSync.completed_at).toLocaleString()}</strong>
              </div>
              <div>
                <small>Roster Size</small>
                <strong>{lastMemberSync.received_count} members</strong>
              </div>
            </div>
          ) : (
            <p className="empty-text">No member sync runs recorded yet.</p>
          )}
        </div>

        <div className="sync-history-box">
          <h4>Event Statuses</h4>
          {lastEventSync ? (
            <div className="sync-stats">
              <div>
                <small>Last Run</small>
                <strong>{new Date(lastEventSync.completed_at).toLocaleString()}</strong>
              </div>
              <div>
                <small>Events Synced</small>
                <strong>{lastEventSync.upserted_count} events</strong>
              </div>
            </div>
          ) : (
            <p className="empty-text">No event sync runs recorded yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
