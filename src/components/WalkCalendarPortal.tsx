"use client";

import { useEffect, useState } from "react";
import {
  CalendarDays,
  Compass,
  MapPin,
  Route,
  Mountain,
  Users,
  CheckCircle2,
  Clock,
  XCircle,
  Plus,
  Search,
  Shield,
  Loader2,
  AlertCircle,
  Eye,
  X,
} from "lucide-react";
import type { Walk, WalkRegistration } from "@/lib/types";
import { CustomSelect, type SelectOption } from "./CustomSelect";

const DIFFICULTY_FILTER_OPTIONS: SelectOption[] = [
  { value: "all", label: "All Difficulties" },
  { value: "easy", label: "Easy / Beginner", color: "#10b981" },
  { value: "moderate", label: "Moderate", color: "#f59e0b" },
  { value: "challenging", label: "Challenging", color: "#ef4444" },
];

const VISIBILITY_FILTER_OPTIONS: SelectOption[] = [
  { value: "all", label: "All Tiers" },
  { value: "public", label: "Public / Taster", color: "#10b981" },
  { value: "members", label: "Standard Members", color: "#0284c7" },
  { value: "explorers", label: "Explorer Only", color: "#7c3aed" },
];

const FORM_DIFFICULTY_OPTIONS: SelectOption[] = [
  { value: "easy", label: "Easy / Beginner", color: "#10b981" },
  { value: "moderate", label: "Moderate", color: "#f59e0b" },
  { value: "challenging", label: "Challenging", color: "#ef4444" },
];

const FORM_VISIBILITY_OPTIONS: SelectOption[] = [
  { value: "public", label: "Public / Taster (Visible to all)", color: "#10b981" },
  { value: "members", label: "Standard Members (Standard & Explorer)", color: "#0284c7" },
  { value: "explorers", label: "Explorer Only (Exclusive to Explorer tier)", color: "#7c3aed" },
];

interface WalkAttendee {
  member_id: string;
  status: "confirmed" | "waitlist";
  created_at: string;
  member?: {
    id: string;
    full_name: string | null;
    email: string;
    membership_tier: string;
  };
}

interface WalkCalendarPortalProps {
  memberId: string;
  membershipTier: string;
  isWalkLeader: boolean;
  isCommittee: boolean;
  initialTab?: "all" | "my_bookings" | "leader";
  onTabChange?: (tab: "all" | "my_bookings" | "leader") => void;
}

const difficultyLabel: Record<string, string> = {
  easy: "Easy / Beginner",
  moderate: "Moderate",
  challenging: "Challenging",
};

const visibilityBadgeLabel: Record<string, { label: string; color: string }> = {
  public: { label: "Public / Taster", color: "#e0f2fe" },
  members: { label: "Standard Members", color: "#fef9c3" },
  explorers: { label: "Explorer Only", color: "#fee2e2" },
};

export function WalkCalendarPortal({
  membershipTier,
  isWalkLeader,
  isCommittee,
  initialTab = "all",
  onTabChange,
}: WalkCalendarPortalProps) {
  const [internalTab, setInternalTab] = useState<"all" | "my_bookings" | "leader">(initialTab);
  const activeTab = onTabChange ? initialTab : internalTab;

  const handleTabSelect = (tab: "all" | "my_bookings" | "leader") => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };
  const [walks, setWalks] = useState<Walk[]>([]);
  const [bookings, setBookings] = useState<WalkRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState("all");

  // Attendee register modal
  const [activeWalkForAttendees, setActiveWalkForAttendees] = useState<Walk | null>(null);
  const [attendees, setAttendees] = useState<WalkAttendee[]>([]);
  const [loadingAttendees, setLoadingAttendees] = useState(false);

  // Create walk modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submittingWalk, setSubmittingWalk] = useState(false);
  const [walkForm, setWalkForm] = useState({
    title: "",
    location: "",
    starts_at: "",
    distance_km: "15",
    ascent_m: "400",
    difficulty: "moderate",
    capacity: "24",
    visibility: "members",
    summary: "",
  });

  const canLead = isWalkLeader || isCommittee;

  const fetchData = async () => {
    try {
      const [walksRes, bookingsRes] = await Promise.all([
        fetch("/api/walks"),
        fetch("/api/walks/bookings"),
      ]);

      if (walksRes.ok) {
        const walksData = await walksRes.json();
        setWalks(walksData.walks || []);
      }
      if (bookingsRes.ok) {
        const bookingsData = await bookingsRes.json();
        setBookings(bookingsData.bookings || []);
      }
    } catch {
      setMessage({ type: "error", text: "Failed to load walks data." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/walks"), fetch("/api/walks/bookings")])
      .then(async ([walksRes, bookingsRes]) => {
        if (!active) return;
        if (walksRes.ok) {
          const walksData = await walksRes.json();
          setWalks(walksData.walks || []);
        }
        if (bookingsRes.ok) {
          const bookingsData = await bookingsRes.json();
          setBookings(bookingsData.bookings || []);
        }
      })
      .catch(() => {
        if (active) setMessage({ type: "error", text: "Failed to load walks data." });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleBookWalk = async (walkId: string) => {
    setActionLoading(walkId);
    setMessage(null);
    try {
      const res = await fetch(`/api/walks/${walkId}/register`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Booking failed" });
      } else {
        setMessage({
          type: "success",
          text: data.message || "Registration completed successfully!",
        });
        await fetchData();
      }
    } catch {
      setMessage({ type: "error", text: "Network error trying to register for walk." });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelBooking = async (walkId: string) => {
    if (!confirm("Are you sure you want to cancel your registration for this walk?")) return;
    setActionLoading(walkId);
    setMessage(null);
    try {
      const res = await fetch(`/api/walks/${walkId}/register`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Cancellation failed" });
      } else {
        setMessage({ type: "success", text: data.message || "Booking cancelled." });
        await fetchData();
      }
    } catch {
      setMessage({ type: "error", text: "Network error trying to cancel booking." });
    } finally {
      setActionLoading(null);
    }
  };

  const openAttendeeRegister = async (walk: Walk) => {
    setActiveWalkForAttendees(walk);
    setLoadingAttendees(true);
    try {
      const res = await fetch(`/api/walks/${walk.id}/attendees`);
      if (res.ok) {
        const data = await res.json();
        setAttendees(data.attendees || []);
      } else {
        setAttendees([]);
      }
    } catch {
      setAttendees([]);
    } finally {
      setLoadingAttendees(false);
    }
  };

  const handleCreateWalk = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingWalk(true);
    setMessage(null);
    try {
      const res = await fetch("/api/walks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(walkForm),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Failed to create walk" });
      } else {
        setMessage({ type: "success", text: `Walk '${walkForm.title}' created successfully!` });
        setShowCreateModal(false);
        setWalkForm({
          title: "",
          location: "",
          starts_at: "",
          distance_km: "15",
          ascent_m: "400",
          difficulty: "moderate",
          capacity: "24",
          visibility: "members",
          summary: "",
        });
        await fetchData();
      }
    } catch {
      setMessage({ type: "error", text: "Network error creating walk." });
    } finally {
      setSubmittingWalk(false);
    }
  };

  const filteredWalks = walks.filter((walk) => {
    const matchQuery =
      walk.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      walk.location.toLowerCase().includes(searchQuery.toLowerCase());
    const matchDiff = difficultyFilter === "all" || walk.difficulty === difficultyFilter;
    const matchVis = visibilityFilter === "all" || walk.visibility === visibilityFilter;
    return matchQuery && matchDiff && matchVis;
  });

  const bookedWalkIds = new Set(bookings.map((b) => b.walk_id));

  return (
    <div className="equipment-portal-shell" style={{ marginTop: 24 }}>
      <div className="equipment-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0 }}>Club Walk Calendar &amp; Bookings</h2>
            <span className="category-badge" style={{ textTransform: "capitalize", fontSize: 11 }}>
              {membershipTier} Member
            </span>
          </div>
          <p style={{ marginTop: 4 }}>Upcoming guided day walks, mountain weekend trips, and your reserved trail places.</p>
        {canLead && (
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="button primary compact"
          >
            <Plus size={16} /> Propose New Walk
          </button>
        )}
      </div>

      <div className="portal-subnav">
        <button
          type="button"
          onClick={() => handleTabSelect("all")}
          className={activeTab === "all" ? "active" : ""}
        >
          <CalendarDays size={16} /> All Upcoming Walks ({walks.length})
        </button>
        <button
          type="button"
          onClick={() => handleTabSelect("my_bookings")}
          className={activeTab === "my_bookings" ? "active" : ""}
        >
          <Compass size={16} /> My Bookings ({bookings.length})
        </button>
        {canLead && (
          <button
            type="button"
            onClick={() => handleTabSelect("leader")}
            className={activeTab === "leader" ? "active" : ""}
          >
            <Shield size={16} /> Leader &amp; Committee Tools
          </button>
        )}
      </div>

      {message && (
        <div className={`alert-banner ${message.type}`}>
          {message.type === "error" ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <p>{message.text}</p>
        </div>
      )}

      {/* ALL WALKS TAB */}
      {activeTab === "all" && (
        <>
          <div className="search-filter-bar">
            <div className="search-box">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search walks by route, hill, or town..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <CustomSelect
              value={difficultyFilter}
              onChange={setDifficultyFilter}
              options={DIFFICULTY_FILTER_OPTIONS}
              variant="pill"
              ariaLabel="Filter walks by difficulty"
            />
            <CustomSelect
              value={visibilityFilter}
              onChange={setVisibilityFilter}
              options={VISIBILITY_FILTER_OPTIONS}
              variant="pill"
              ariaLabel="Filter walks by membership tier"
            />
          </div>

          {loading ? (
            <div className="sync-monitor-card loading">
              <Loader2 className="animate-spin" size={24} />
              <span>Loading walk schedule...</span>
            </div>
          ) : filteredWalks.length === 0 ? (
            <div className="empty-state" style={{ padding: "40px", textAlign: "center", opacity: 0.7 }}>
              <p>No walks match your selected filters.</p>
            </div>
          ) : (
            <div className="equipment-grid">
              {filteredWalks.map((walk) => {
                const date = new Intl.DateTimeFormat("en-GB", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(walk.starts_at));

                const isRegistered = walk.my_registration || (bookedWalkIds.has(walk.id) ? "confirmed" : null);
                const isFull = walk.spaces_remaining <= 0;
                const visBadge = visibilityBadgeLabel[walk.visibility] || { label: walk.visibility, color: "#f1f5f9" };

                const isBusy = actionLoading === walk.id;

                return (
                  <div key={walk.id} className="equipment-card" style={{ display: "flex", flexDirection: "column" }}>
                    <div>
                      <div className="equipment-card-header">
                        <span
                          className="category-badge"
                          style={{ background: visBadge.color, color: "#1e293b" }}
                        >
                          {visBadge.label}
                        </span>
                        <span className={`condition-badge ${walk.difficulty === "easy" ? "excellent" : walk.difficulty === "moderate" ? "fair" : "needs_repair"}`}>
                          {difficultyLabel[walk.difficulty] || walk.difficulty}
                        </span>
                      </div>
                      <h3>{walk.title}</h3>
                      <p style={{ margin: "0 0 10px 0", fontSize: 13, color: "var(--ink)", opacity: 0.85 }}>
                        <MapPin size={14} style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />
                        {walk.location}
                      </p>
                      {walk.summary && <p style={{ fontSize: 12, marginBottom: 14 }}>{walk.summary}</p>}

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12, opacity: 0.8, marginBottom: 14 }}>
                        <span>
                          <CalendarDays size={14} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />
                          {date}
                        </span>
                        <span>
                          <Route size={14} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />
                          {walk.distance_km} km
                        </span>
                        <span>
                          <Mountain size={14} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />
                          {walk.ascent_m}m ascent
                        </span>
                        <span>
                          <Users size={14} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />
                          {walk.spaces_remaining} / {walk.capacity} left
                        </span>
                      </div>

                      {walk.leader?.full_name && (
                        <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 12 }}>
                          Led by <strong>{walk.leader.full_name}</strong>
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px dashed var(--line)" }}>
                      {isRegistered ? (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span
                            className={`req-status ${isRegistered === "confirmed" ? "approved" : "pending"}`}
                            style={{ fontSize: 11 }}
                          >
                            {isRegistered === "confirmed" ? <CheckCircle2 size={13} /> : <Clock size={13} />}
                            {isRegistered === "confirmed" ? "Confirmed Spot" : "Waitlisted"}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCancelBooking(walk.id)}
                            disabled={isBusy}
                            className="text-danger"
                            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                          >
                            {isBusy ? <Loader2 className="animate-spin" size={13} /> : <XCircle size={13} />}
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => handleBookWalk(walk.id)}
                            disabled={isBusy}
                            className={`button ${isFull ? "compact" : "primary compact"} full-width`}
                            style={{ width: "100%", justifyContent: "center" }}
                          >
                            {isBusy ? (
                              <Loader2 className="animate-spin" size={15} />
                            ) : isFull ? (
                              <>
                                <Clock size={15} /> Join Waitlist
                              </>
                            ) : (
                              <>
                                <CheckCircle2 size={15} /> Book Walk
                              </>
                            )}
                          </button>
                          {canLead && (
                            <button
                              type="button"
                              onClick={() => openAttendeeRegister(walk)}
                              className="button compact"
                              title="View attendee register"
                            >
                              <Eye size={15} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* MY BOOKINGS TAB */}
      {activeTab === "my_bookings" && (
        <div className="requests-list">
          {bookings.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 20px", background: "white", borderRadius: 16 }}>
              <Compass size={36} style={{ opacity: 0.3, marginBottom: 12 }} />
              <h3>No Active Walk Bookings</h3>
              <p style={{ opacity: 0.65, fontSize: 14 }}>
                Browse the upcoming calendar tab to reserve your spot on our weekend hikes.
              </p>
              <button
                type="button"
                onClick={() => handleTabSelect("all")}
                className="button primary compact"
                style={{ marginTop: 12 }}
              >
                Browse Walks Calendar
              </button>
            </div>
          ) : (
            bookings.map((booking) => {
              const walk = booking.walk;
              if (!walk) return null;
              const date = new Intl.DateTimeFormat("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(walk.starts_at));

              const isBusy = actionLoading === walk.id;

              return (
                <div key={booking.walk_id} className="request-card">
                  <div className="request-header">
                    <div>
                      <strong>{walk.title}</strong>
                      <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>
                        <MapPin size={13} style={{ display: "inline", verticalAlign: "-2px" }} /> {walk.location} · {walk.distance_km} km · {walk.ascent_m}m ascent
                      </div>
                    </div>
                    <span className={`req-status ${booking.status === "confirmed" ? "approved" : "pending"}`}>
                      {booking.status === "confirmed" ? <CheckCircle2 size={13} /> : <Clock size={13} />}
                      {booking.status === "confirmed" ? "Spot Confirmed" : "On Waitlist"}
                    </span>
                  </div>

                  <div className="request-details">
                    <span>
                      <CalendarDays size={14} /> {date}
                    </span>
                    {walk.leader?.full_name && (
                      <span>
                        <Shield size={14} /> Leader: {walk.leader.full_name}
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                    <span style={{ fontSize: 12, opacity: 0.6 }}>
                      Registered on {new Date(booking.created_at).toLocaleDateString("en-GB")}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCancelBooking(walk.id)}
                      disabled={isBusy}
                      className="text-danger"
                      style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                    >
                      {isBusy ? <Loader2 className="animate-spin" size={13} /> : <XCircle size={14} />}
                      Cancel Booking
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* LEADER & COMMITTEE TAB */}
      {activeTab === "leader" && canLead && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <div>
              <h3 style={{ margin: 0, font: "800 18px var(--font-display)" }}>Walk Management &amp; Registers</h3>
              <p style={{ margin: "2px 0 0", fontSize: 13, opacity: 0.65 }}>
                Inspect participant registers, view waitlists, or draft new official routes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="button primary compact"
            >
              <Plus size={16} /> Propose New Walk
            </button>
          </div>

          <div className="requests-table-wrapper">
            <table className="requests-table">
              <thead>
                <tr>
                  <th>Walk Title</th>
                  <th>Date &amp; Time</th>
                  <th>Location</th>
                  <th>Tier Visibility</th>
                  <th>Capacity</th>
                  <th>Spots Left</th>
                  <th>Leader</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {walks.map((w) => {
                  const dateStr = new Intl.DateTimeFormat("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(w.starts_at));

                  return (
                    <tr key={w.id}>
                      <td><strong>{w.title}</strong></td>
                      <td>{dateStr}</td>
                      <td>{w.location}</td>
                      <td>
                        <span className="category-badge" style={{ background: visibilityBadgeLabel[w.visibility]?.color || "#eee", color: "#1e293b" }}>
                          {visibilityBadgeLabel[w.visibility]?.label || w.visibility}
                        </span>
                      </td>
                      <td>{w.capacity}</td>
                      <td>
                        <span style={{ fontWeight: 700, color: w.spaces_remaining > 0 ? "#166534" : "#b91c1c" }}>
                          {w.spaces_remaining}
                        </span>
                      </td>
                      <td>{w.leader?.full_name || "Unassigned"}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => openAttendeeRegister(w)}
                          className="btn-action return"
                          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                        >
                          <Users size={13} /> View Register
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ATTENDEE REGISTER MODAL */}
      {activeWalkForAttendees && (
        <div className="modal-overlay" onClick={() => setActiveWalkForAttendees(null)}>
          <div className="modal-card" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3>{activeWalkForAttendees.title}</h3>
                <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>
                  Attendee Register · {activeWalkForAttendees.location}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveWalkForAttendees(null)}
                style={{ background: "none", border: "none", cursor: "pointer" }}
              >
                <X size={20} />
              </button>
            </div>

            {loadingAttendees ? (
              <div style={{ padding: 40, textAlign: "center" }}>
                <Loader2 className="animate-spin" size={24} />
                <p>Loading register...</p>
              </div>
            ) : attendees.length === 0 ? (
              <p style={{ textAlign: "center", padding: "30px 0", opacity: 0.6 }}>
                No members have registered for this walk yet.
              </p>
            ) : (
              <div className="requests-table-wrapper" style={{ maxHeight: 380, overflowY: "auto" }}>
                <table className="requests-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Tier</th>
                      <th>Registered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendees.map((att, idx) => (
                      <tr key={idx}>
                        <td>
                          <span className={`req-status ${att.status === "confirmed" ? "approved" : "pending"}`} style={{ fontSize: 10 }}>
                            {att.status === "confirmed" ? "Confirmed" : "Waitlist"}
                          </span>
                        </td>
                        <td><strong>{att.member?.full_name || "Hiker"}</strong></td>
                        <td>{att.member?.email}</td>
                        <td><span className="category-badge">{att.member?.membership_tier}</span></td>
                        <td>{new Date(att.created_at).toLocaleDateString("en-GB")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setActiveWalkForAttendees(null)}
                className="button primary compact"
              >
                Close Register
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE WALK MODAL */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-card" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
            <h3>Propose New Walk</h3>
            <p>Schedule a new club hike. Walks become bookable according to their visibility tier.</p>
            <form onSubmit={handleCreateWalk} className="su-session-form">
              <div className="form-group">
                <label>Walk Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Surrey Hills & Leith Hill Tower"
                  value={walkForm.title}
                  onChange={(e) => setWalkForm({ ...walkForm, title: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Location / Destination</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Dorking to Holmwood"
                    value={walkForm.location}
                    onChange={(e) => setWalkForm({ ...walkForm, location: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Date &amp; Meeting Time</label>
                  <input
                    type="datetime-local"
                    required
                    value={walkForm.starts_at}
                    onChange={(e) => setWalkForm({ ...walkForm, starts_at: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Distance (km)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    required
                    value={walkForm.distance_km}
                    onChange={(e) => setWalkForm({ ...walkForm, distance_km: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Total Ascent (m)</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={walkForm.ascent_m}
                    onChange={(e) => setWalkForm({ ...walkForm, ascent_m: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Difficulty</label>
                  <CustomSelect
                    value={walkForm.difficulty}
                    onChange={(val) => setWalkForm({ ...walkForm, difficulty: val })}
                    options={FORM_DIFFICULTY_OPTIONS}
                    variant="input"
                    ariaLabel="Select difficulty"
                  />
                </div>
                <div className="form-group">
                  <label>Capacity</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={walkForm.capacity}
                    onChange={(e) => setWalkForm({ ...walkForm, capacity: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Membership Visibility</label>
                <CustomSelect
                  value={walkForm.visibility}
                  onChange={(val) => setWalkForm({ ...walkForm, visibility: val })}
                  options={FORM_VISIBILITY_OPTIONS}
                  variant="input"
                  ariaLabel="Select membership visibility"
                />
                <span className="form-hint">
                  Explorer-only walks are gated to members with active Explorer membership.
                </span>
              </div>

              <div className="form-group">
                <label>Route Summary &amp; Kit Notes</label>
                <textarea
                  rows={3}
                  placeholder="Outline terrain, footwear requirements, train ticketing advice..."
                  value={walkForm.summary}
                  onChange={(e) => setWalkForm({ ...walkForm, summary: e.target.value })}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="button compact"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingWalk}
                  className="button primary compact"
                >
                  {submittingWalk ? "Publishing..." : "Publish Walk"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
