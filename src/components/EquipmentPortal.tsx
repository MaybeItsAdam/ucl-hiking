"use client";

import { useEffect, useState } from "react";
import {
  Package,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  Plus,
  Filter,
  Search,
  AlertCircle,
  FileText,
  ShieldCheck,
} from "lucide-react";
import type { Equipment, EquipmentRequest } from "@/lib/types";

interface EquipmentPortalProps {
  memberId: string;
  membershipTier: string;
  isCommittee: boolean;
}

export function EquipmentPortal({ memberId, membershipTier, isCommittee }: EquipmentPortalProps) {
  const [activeTab, setActiveTab] = useState<"catalog" | "my_requests" | "committee_review">("catalog");
  const [items, setItems] = useState<Equipment[]>([]);
  const [requests, setRequests] = useState<EquipmentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Borrow Modal State
  const [selectedItem, setSelectedItem] = useState<Equipment | null>(null);
  const [borrowQty, setBorrowQty] = useState(1);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [purpose, setPurpose] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Add Item Modal State (Committee)
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("Tents & Shelter");
  const [newItemDesc, setNewItemDesc] = useState("");
  const [newItemTotal, setNewItemTotal] = useState(2);
  const [newItemCondition, setNewItemCondition] = useState<"excellent" | "good" | "fair" | "needs_repair">("good");

  // Rejection notes modal
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [rejectionNotes, setRejectionNotes] = useState("");

  const fetchData = async () => {
    try {
      const [eqRes, reqRes] = await Promise.all([
        fetch("/api/equipment"),
        fetch("/api/equipment/requests"),
      ]);

      if (eqRes.ok) {
        const eqData = await eqRes.json();
        setItems(eqData.equipment || []);
      }
      if (reqRes.ok) {
        const reqData = await reqRes.json();
        setRequests(reqData.requests || []);
      }
    } catch {
      setMsg({ type: "error", text: "Failed to load equipment data" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/equipment"), fetch("/api/equipment/requests")])
      .then(async ([eqRes, reqRes]) => {
        if (!active) return;
        if (eqRes.ok) {
          const eqData = await eqRes.json();
          setItems(eqData.equipment || []);
        }
        if (reqRes.ok) {
          const reqData = await reqRes.json();
          setRequests(reqData.requests || []);
        }
      })
      .catch(() => {
        if (active) setMsg({ type: "error", text: "Failed to load equipment data" });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleFileRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;

    setSubmitting(true);
    setMsg(null);

    try {
      const res = await fetch("/api/equipment/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equipmentId: selectedItem.id,
          quantity: borrowQty,
          startDate,
          endDate,
          purpose,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "error", text: data.error || "Failed to submit request" });
      } else {
        setMsg({ type: "success", text: `Borrow request submitted for ${selectedItem.name}!` });
        setSelectedItem(null);
        setBorrowQty(1);
        setStartDate("");
        setEndDate("");
        setPurpose("");
        setActiveTab("my_requests");
        fetchData();
      }
    } catch {
      setMsg({ type: "error", text: "Network error submitting request" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async (requestId: string, status: string, notes?: string) => {
    setMsg(null);
    try {
      const res = await fetch(`/api/equipment/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, notes }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "error", text: data.error || "Failed to update request" });
      } else {
        setMsg({ type: "success", text: `Request status updated to ${status}.` });
        setRejectingRequestId(null);
        setRejectionNotes("");
        fetchData();
      }
    } catch {
      setMsg({ type: "error", text: "Error updating request" });
    }
  };

  const handleCreateEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;

    setSubmitting(true);
    setMsg(null);

    try {
      const res = await fetch("/api/equipment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newItemName.trim(),
          category: newItemCategory,
          description: newItemDesc.trim() || undefined,
          totalQuantity: newItemTotal,
          availableQuantity: newItemTotal,
          condition: newItemCondition,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "error", text: data.error || "Failed to add equipment" });
      } else {
        setMsg({ type: "success", text: `Added ${newItemName} to inventory!` });
        setShowAddItemModal(false);
        setNewItemName("");
        setNewItemDesc("");
        fetchData();
      }
    } catch {
      setMsg({ type: "error", text: "Error adding equipment" });
    } finally {
      setSubmitting(false);
    }
  };

  const categories = Array.from(new Set(items.map((i) => i.category)));

  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      (item.description && item.description.toLowerCase().includes(search.toLowerCase()));
    const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const myRequests = requests.filter((r) => r.member_id === memberId);
  const pendingRequestsCount = requests.filter((r) => r.status === "pending").length;

  if (loading) {
    return (
      <div className="equipment-portal-shell loading">
        <Package className="animate-spin" size={24} />
        <span>Loading equipment tracking portal...</span>
      </div>
    );
  }

  return (
    <div className="equipment-portal-shell">
      <div className="equipment-header">
        <div>
          <h2>Club Equipment &amp; Inventory Tracking</h2>
          <p>Standard and Explorer members can request club gear for upcoming hikes.</p>
        </div>
        {isCommittee && (
          <button onClick={() => setShowAddItemModal(true)} className="button primary compact">
            <Plus size={16} /> Add Equipment Item
          </button>
        )}
      </div>

      {msg && (
        <div className={`alert-banner ${msg.type}`}>
          {msg.type === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{msg.text}</span>
        </div>
      )}

      <div className="portal-subnav">
        <button
          className={activeTab === "catalog" ? "active" : ""}
          onClick={() => setActiveTab("catalog")}
        >
          <Package size={16} /> Equipment Catalog ({items.length})
        </button>

        <button
          className={activeTab === "my_requests" ? "active" : ""}
          onClick={() => setActiveTab("my_requests")}
        >
          <FileText size={16} /> My Borrow Requests ({myRequests.length})
        </button>

        {isCommittee && (
          <button
            className={activeTab === "committee_review" ? "active" : ""}
            onClick={() => setActiveTab("committee_review")}
          >
            <ShieldCheck size={16} /> Committee Review ({pendingRequestsCount} pending)
          </button>
        )}
      </div>

      {/* CATALOG TAB */}
      {activeTab === "catalog" && (
        <div className="catalog-section">
          <div className="search-filter-bar">
            <div className="search-box">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search tents, rucksacks, boots, compasses..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="filter-box">
              <Filter size={16} />
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">All Categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="equipment-grid">
            {filteredItems.map((item) => {
              const isAvailable = item.available_quantity > 0;
              return (
                <div key={item.id} className="equipment-card">
                  <div className="equipment-card-header">
                    <span className="category-badge">{item.category}</span>
                    <span className={`condition-badge ${item.condition}`}>{item.condition}</span>
                  </div>
                  <h3>{item.name}</h3>
                  <p>{item.description || "Official UCL Hiking Club kit available for member loan."}</p>

                  <div className="stock-info">
                    <span>
                      Available: <strong>{item.available_quantity}</strong> / {item.total_quantity}
                    </span>
                    <span className={`stock-status ${isAvailable ? "in-stock" : "out-of-stock"}`}>
                      {isAvailable ? "In Stock" : "On Loan / Unavailable"}
                    </span>
                  </div>

                  {membershipTier === "taster" ? (
                    <small className="taster-notice">Taster members must upgrade to Standard/Explorer to borrow kit.</small>
                  ) : (
                    <button
                      disabled={!isAvailable}
                      onClick={() => setSelectedItem(item)}
                      className="button primary compact full-width"
                    >
                      Request to Borrow
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MY REQUESTS TAB */}
      {activeTab === "my_requests" && (
        <div className="requests-section">
          {myRequests.length === 0 ? (
            <div className="empty-state">
              <Package size={36} />
              <p>You haven&apos;t filed any equipment borrowing requests yet.</p>
              <button onClick={() => setActiveTab("catalog")} className="button primary compact">
                Browse Equipment Catalog
              </button>
            </div>
          ) : (
            <div className="requests-list">
              {myRequests.map((req) => (
                <div key={req.id} className="request-card">
                  <div className="request-header">
                    <strong>{req.equipment?.name || "Equipment Item"}</strong>
                    <span className={`req-status ${req.status}`}>
                      {req.status === "pending" && <Clock size={13} />}
                      {req.status === "approved" && <CheckCircle2 size={13} />}
                      {req.status === "rejected" && <XCircle size={13} />}
                      {req.status === "returned" && <RotateCcw size={13} />}
                      {req.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="request-details">
                    <span>
                      <Calendar size={13} /> {req.start_date} to {req.end_date}
                    </span>
                    <span>Quantity: {req.quantity}</span>
                  </div>
                  <p className="purpose-text">
                    <strong>Purpose:</strong> {req.purpose}
                  </p>
                  {req.notes && (
                    <p className="committee-notes">
                      <strong>Committee Feedback:</strong> {req.notes}
                    </p>
                  )}

                  {req.status === "pending" && (
                    <button
                      onClick={() => handleUpdateStatus(req.id, "cancelled")}
                      className="button-link text-danger"
                    >
                      Cancel Request
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* COMMITTEE REVIEW TAB */}
      {activeTab === "committee_review" && isCommittee && (
        <div className="committee-review-section">
          <h3>Member Borrowing Requests Queue</h3>
          {requests.length === 0 ? (
            <p className="empty-text">No borrow requests submitted.</p>
          ) : (
            <div className="requests-table-wrapper">
              <table className="requests-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Equipment</th>
                    <th>Qty</th>
                    <th>Dates</th>
                    <th>Purpose</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req) => (
                    <tr key={req.id}>
                      <td>
                        <strong>{req.member?.full_name || "Member"}</strong>
                        <br />
                        <small>{req.member?.email}</small>
                      </td>
                      <td>{req.equipment?.name}</td>
                      <td>{req.quantity}</td>
                      <td>
                        <small>
                          {req.start_date} → {req.end_date}
                        </small>
                      </td>
                      <td>
                        <small>{req.purpose}</small>
                      </td>
                      <td>
                        <span className={`req-status ${req.status}`}>{req.status}</span>
                      </td>
                      <td className="actions-cell">
                        {req.status === "pending" && (
                          <>
                            <button
                              onClick={() => handleUpdateStatus(req.id, "approved")}
                              className="btn-action approve"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => setRejectingRequestId(req.id)}
                              className="btn-action reject"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {req.status === "approved" && (
                          <button
                            onClick={() => handleUpdateStatus(req.id, "returned")}
                            className="btn-action return"
                          >
                            Mark Returned
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* BORROW REQUEST MODAL */}
      {selectedItem && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Borrow Request: {selectedItem.name}</h3>
            <p>Specify dates and borrowing purpose for committee approval.</p>

            <form onSubmit={handleFileRequest}>
              <div className="form-group">
                <label>Quantity Needed (Max {selectedItem.available_quantity}):</label>
                <input
                  type="number"
                  min={1}
                  max={selectedItem.available_quantity}
                  value={borrowQty}
                  onChange={(e) => setBorrowQty(parseInt(e.target.value) || 1)}
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Start Date:</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>End Date:</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Borrowing Purpose / Hike Details:</label>
                <textarea
                  rows={3}
                  placeholder="Describe where and when you plan to use this equipment..."
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  required
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => setSelectedItem(null)}
                  className="button compact"
                >
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="button primary compact">
                  {submitting ? "Submitting..." : "Submit Borrow Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REJECTION NOTES MODAL */}
      {rejectingRequestId && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Reject Equipment Request</h3>
            <p>Provide a reason/feedback for the member.</p>
            <textarea
              rows={3}
              placeholder="Reason for rejection (e.g. equipment reserved for official club trip)..."
              value={rejectionNotes}
              onChange={(e) => setRejectionNotes(e.target.value)}
            />
            <div className="modal-actions">
              <button onClick={() => setRejectingRequestId(null)} className="button compact">
                Cancel
              </button>
              <button
                onClick={() => handleUpdateStatus(rejectingRequestId, "rejected", rejectionNotes)}
                className="button primary compact"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD EQUIPMENT MODAL */}
      {showAddItemModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Add Equipment Item to Inventory</h3>

            <form onSubmit={handleCreateEquipment}>
              <div className="form-group">
                <label>Equipment Name:</label>
                <input
                  type="text"
                  placeholder="e.g. MSR 2-Person Expedition Tent"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Category:</label>
                <select
                  value={newItemCategory}
                  onChange={(e) => setNewItemCategory(e.target.value)}
                >
                  <option value="Tents & Shelter">Tents &amp; Shelter</option>
                  <option value="Footwear & Boots">Footwear &amp; Boots</option>
                  <option value="Rucksacks & Bags">Rucksacks &amp; Bags</option>
                  <option value="Navigation & Safety">Navigation &amp; Safety</option>
                  <option value="Cooking & Stoves">Cooking &amp; Stoves</option>
                  <option value="Sleeping Gear">Sleeping Gear</option>
                </select>
              </div>

              <div className="form-group">
                <label>Description:</label>
                <input
                  type="text"
                  placeholder="Short description, capacity or specs"
                  value={newItemDesc}
                  onChange={(e) => setNewItemDesc(e.target.value)}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Total Stock Quantity:</label>
                  <input
                    type="number"
                    min={1}
                    value={newItemTotal}
                    onChange={(e) => setNewItemTotal(parseInt(e.target.value) || 1)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Condition:</label>
                  <select
                    value={newItemCondition}
                    onChange={(e) =>
                      setNewItemCondition(
                        e.target.value as "excellent" | "good" | "fair" | "needs_repair",
                      )
                    }
                  >
                    <option value="excellent">Excellent</option>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="needs_repair">Needs Repair</option>
                  </select>
                </div>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => setShowAddItemModal(false)}
                  className="button compact"
                >
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="button primary compact">
                  {submitting ? "Adding..." : "Add Equipment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
