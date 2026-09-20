"use client";

import { useEffect, useState, useMemo } from "react";
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
  Loader2,
  Edit2,
  Trash2,
  AlertTriangle,
  X,
  Layers,
  Send,
  ArrowUpRight,
  ArrowDownLeft,
  Settings,
} from "lucide-react";
import type { Equipment, EquipmentRequest } from "@/lib/types";
import { CustomSelect, type SelectOption } from "./CustomSelect";
import { Sheet } from "./Sheet";
import { useAppRefresh } from "@/lib/refresh";

const EQUIPMENT_CATEGORY_OPTIONS: SelectOption[] = [
  { value: "Tents & Shelter", label: "Tents & Shelter" },
  { value: "Footwear & Boots", label: "Footwear & Boots" },
  { value: "Rucksacks & Bags", label: "Rucksacks & Bags" },
  { value: "Navigation & Safety", label: "Navigation & Safety" },
  { value: "Cooking & Stoves", label: "Cooking & Stoves" },
  { value: "Sleeping Gear", label: "Sleeping Gear" },
  { value: "General & Other", label: "General & Other" },
];

const CONDITION_OPTIONS: SelectOption[] = [
  { value: "excellent", label: "Excellent (Like New)", color: "#10b981" },
  { value: "good", label: "Good (Normal Trail Use)", color: "#059669" },
  { value: "fair", label: "Fair (Usable, Cosmetic Wear)", color: "#f59e0b" },
  { value: "needs_repair", label: "Needs Repair (Flagged/Unsafe)", color: "var(--bad-fg)" },
];

interface EquipmentPortalProps {
  memberId: string;
  /** Principals manage the kit and review loans; everyone else here borrows it. */
  isPrincipal: boolean;
  initialTab?: "catalog" | "requests" | "committee_review" | "active_loans" | "my_requests";
  onTabChange?: (tab: "catalog" | "requests" | "active_loans" | "my_requests") => void;
}

export function EquipmentPortal({
  memberId,
  isPrincipal,
  initialTab = "catalog",
  onTabChange,
}: EquipmentPortalProps) {
  const normalizedInitialTab = initialTab === "committee_review" ? "requests" : initialTab;
  const [internalTab, setInternalTab] = useState<"catalog" | "requests" | "active_loans" | "my_requests">(normalizedInitialTab);
  const activeTab = onTabChange ? normalizedInitialTab : internalTab;

  const handleTabSelect = (tab: "catalog" | "requests" | "active_loans" | "my_requests") => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };

  const [items, setItems] = useState<Equipment[]>([]);
  const [requests, setRequests] = useState<EquipmentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "in_stock" | "out_of_stock" | "needs_repair">("all");
  const [requestStatusFilter, setRequestStatusFilter] = useState<"all" | "pending" | "approved" | "returned" | "rejected">("all");
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
  const [newItemAvailable, setNewItemAvailable] = useState(2);
  const [newItemCondition, setNewItemCondition] = useState<"excellent" | "good" | "fair" | "needs_repair">("good");

  // Edit Item Modal State (Committee)
  const [editingItem, setEditingItem] = useState<Equipment | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("Tents & Shelter");
  const [editDesc, setEditDesc] = useState("");
  const [editTotal, setEditTotal] = useState(1);
  const [editAvailable, setEditAvailable] = useState(1);
  const [editCondition, setEditCondition] = useState<"excellent" | "good" | "fair" | "needs_repair">("good");

  // Delete Item Modal State (Committee)
  const [deletingItem, setDeletingItem] = useState<Equipment | null>(null);

  // Rejection notes modal
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [rejectionNotes, setRejectionNotes] = useState("");
  const [syncingSheets, setSyncingSheets] = useState(false);
  const [syncDirection, setSyncDirection] = useState<"push" | "pull" | null>(null);

  // Google Sheets Webhook Configuration State
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsWebhookUrl, setSettingsWebhookUrl] = useState("");
  const [settingsSheetId, setSettingsSheetId] = useState("");
  const [isConfigured, setIsConfigured] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

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

  useAppRefresh(fetchData);

  // Fetch webhook configuration status for committee
  useEffect(() => {
    if (isPrincipal) {
      fetch("/api/equipment/settings")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) {
            setSettingsWebhookUrl(d.webhookUrl || "");
            setSettingsSheetId(d.sheetId || "");
            setIsConfigured(Boolean(d.configured));
          }
        })
        .catch(() => {});
    }
  }, [isPrincipal]);

  const handleSyncSheets = async (direction: "push" | "pull" = "push") => {
    setSyncDirection(direction);
    setSyncingSheets(true);
    setMsg(null);
    try {
      const res = await fetch("/api/equipment/sync-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({
          type: "error",
          text: data.error || `Failed to ${direction === "pull" ? "import from" : "sync to"} Google Sheets`,
        });
      } else {
        if (direction === "pull") {
          const text =
            data.message ||
            `Successfully pulled and updated ${data.importedCount} items from Google Sheets!`;
          setMsg({ type: "success", text });
          await fetchData();
        } else {
          if (data.webhookDelivered) {
            const text =
              data.message ||
              `Pushed to Google Sheets with UCL Hiking styling! ${data.equipmentCount} items formatted in 'Master List', ${data.requestsCount} in 'Ledger Log', and 'Dashboard' formulas updated.`;
            setMsg({ type: "success", text });
          } else {
            setMsg({
              type: "error",
              text: data.message || "Failed to deliver styling to Google Sheets. Check your webhook URL, deployment version, and permissions.",
            });
          }
        }
      }
    } catch {
      setMsg({ type: "error", text: `Network error during ${direction} sync with Google Sheets` });
    } finally {
      setSyncingSheets(false);
      setSyncDirection(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setMsg(null);

    try {
      const res = await fetch("/api/equipment/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: settingsWebhookUrl,
          sheetId: settingsSheetId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "error", text: data.error || "Failed to save webhook settings" });
      } else {
        setIsConfigured(Boolean(settingsWebhookUrl.trim()));
        setShowSettingsModal(false);
        setMsg({
          type: "success",
          text: "Google Sheets webhook configuration saved! Two-way sync is active.",
        });
      }
    } catch {
      setMsg({ type: "error", text: "Network error saving settings" });
    } finally {
      setSavingSettings(false);
    }
  };

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
        handleTabSelect("my_requests");
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
        const statusLabel =
          status === "approved"
            ? "Loan approved and stock updated"
            : status === "returned"
            ? "Kit marked returned and restored to inventory"
            : `Request marked as ${status}`;
        setMsg({ type: "success", text: statusLabel });
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
          availableQuantity: Math.min(newItemAvailable, newItemTotal),
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
        setNewItemTotal(2);
        setNewItemAvailable(2);
        fetchData();
      }
    } catch {
      setMsg({ type: "error", text: "Error adding equipment" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEdit = (item: Equipment) => {
    setEditingItem(item);
    setEditName(item.name);
    setEditCategory(item.category);
    setEditDesc(item.description || "");
    setEditTotal(item.total_quantity);
    setEditAvailable(item.available_quantity);
    setEditCondition(item.condition);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editName.trim()) return;

    setSubmitting(true);
    setMsg(null);

    try {
      const res = await fetch("/api/equipment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingItem.id,
          name: editName.trim(),
          category: editCategory,
          description: editDesc.trim() || undefined,
          totalQuantity: editTotal,
          availableQuantity: Math.min(editAvailable, editTotal),
          condition: editCondition,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "error", text: data.error || "Failed to update item" });
      } else {
        setMsg({ type: "success", text: `Updated ${editName} successfully.` });
        setEditingItem(null);
        fetchData();
      }
    } catch {
      setMsg({ type: "error", text: "Error updating equipment" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteEquipment = async () => {
    if (!deletingItem) return;

    setSubmitting(true);
    setMsg(null);

    try {
      const res = await fetch("/api/equipment", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deletingItem.id }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "error", text: data.error || "Failed to delete equipment item" });
      } else {
        setMsg({ type: "success", text: `Removed ${deletingItem.name} from inventory.` });
        setDeletingItem(null);
        fetchData();
      }
    } catch {
      setMsg({ type: "error", text: "Error deleting equipment" });
    } finally {
      setSubmitting(false);
    }
  };

  const pendingRequests = useMemo(() => requests.filter((r) => r.status === "pending"), [requests]);
  const activeLoans = useMemo(() => requests.filter((r) => r.status === "approved"), [requests]);
  const myRequests = useMemo(() => requests.filter((r) => r.member_id === memberId), [requests, memberId]);

  const categories = useMemo(() => {
    const list = Array.from(new Set(items.map((i) => i.category)));
    return list.sort();
  }, [items]);

  const categoryFilterOptions: SelectOption[] = useMemo(() => [
    { value: "all", label: "All Categories", badge: items.length },
    ...categories.map((c) => ({
      value: c,
      label: c,
      badge: items.filter((i) => i.category === c).length,
    })),
  ], [categories, items]);

  const statusFilterOptions: SelectOption[] = useMemo(() => [
    { value: "all", label: "All Stock Status", badge: items.length },
    {
      value: "in_stock",
      label: "In Stock Only",
      color: "#10b981",
      badge: items.filter((i) => i.available_quantity > 0).length,
    },
    {
      value: "out_of_stock",
      label: "Out of Stock",
      color: "#ef4444",
      badge: items.filter((i) => i.available_quantity === 0).length,
    },
    {
      value: "needs_repair",
      label: "Needs Repair",
      color: "#f59e0b",
      badge: items.filter((i) => i.condition === "needs_repair").length,
    },
  ], [items]);

  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      (item.description && item.description.toLowerCase().includes(search.toLowerCase())) ||
      item.category.toLowerCase().includes(search.toLowerCase());

    const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;

    let matchesStatus = true;
    if (statusFilter === "in_stock") matchesStatus = item.available_quantity > 0;
    else if (statusFilter === "out_of_stock") matchesStatus = item.available_quantity === 0;
    else if (statusFilter === "needs_repair") matchesStatus = item.condition === "needs_repair";

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const filteredRequests = useMemo(() => {
    if (requestStatusFilter === "all") return requests;
    return requests.filter((r) => r.status === requestStatusFilter);
  }, [requests, requestStatusFilter]);

  if (loading) {
    return (
      <div className="equipment-portal-shell" style={{ marginTop: 0 }} aria-busy="true">
        <p className="sr-only" role="status">Loading equipment inventory…</p>
        <div className="equipment-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton-card">
              <span className="skeleton" />
              <span className="skeleton" />
              <span className="skeleton" />
              <span className="skeleton" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="equipment-portal-shell" style={{ marginTop: 0 }}>
      {/* 1. PRINCIPAL INVENTORY ACTIONS */}
      {isPrincipal && (
      <div className="equipment-header">
          <div className="equipment-header-actions" style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            {/* Two-Way Sync & Settings Toolbar */}
            <div
              className="sheets-sync-toolbar"
              style={{
                display: "inline-flex",
                borderRadius: "8px",
                overflow: "hidden",
                border: "1px solid var(--line)",
                background: "var(--surface)",
                boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
              }}
            >
              <button
                type="button"
                onClick={() => handleSyncSheets("push")}
                disabled={syncingSheets}
                className="button compact"
                style={{
                  borderRadius: 0,
                  border: "none",
                  borderRight: "1px solid var(--line)",
                  background: "transparent",
                  fontSize: "12px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 12px",
                }}
                aria-label="Push to Sheets"
                title="Export database to Google Sheets and impose UCL Hiking styling, formulas & validation dropdowns"
              >
                {syncingSheets && syncDirection === "push" ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  <ArrowUpRight size={14} style={{ color: "var(--forest)" }} />
                )}
                <span>Push to Sheets</span>
              </button>

              <button
                type="button"
                onClick={() => handleSyncSheets("pull")}
                disabled={syncingSheets}
                className="button compact"
                style={{
                  borderRadius: 0,
                  border: "none",
                  background: "transparent",
                  fontSize: "12px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 12px",
                }}
                aria-label="Pull from Sheets"
                title="Import edits, quantities, and newly added equipment rows from Google Sheets into website database"
              >
                {syncingSheets && syncDirection === "pull" ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  <ArrowDownLeft size={14} style={{ color: "#2563eb" }} />
                )}
                <span>Pull from Sheets</span>
              </button>

              <button
                type="button"
                onClick={() => setShowSettingsModal(true)}
                className="button compact"
                style={{
                  borderRadius: 0,
                  border: "none",
                  borderLeft: "1px solid var(--line)",
                  background: "transparent",
                  fontSize: "12px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "8px 11px",
                  position: "relative",
                }}
                aria-label="Google Sheets settings"
                title="Configure Google Sheets Webhook URL & Connection"
              >
                <Settings size={14} style={{ opacity: 0.75 }} />
                {!isConfigured && (
                  <span
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: "#f59e0b",
                    }}
                    title="Webhook not configured"
                  />
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setNewItemName("");
                setNewItemDesc("");
                setNewItemTotal(2);
                setNewItemAvailable(2);
                setShowAddItemModal(true);
              }}
              className="button primary compact add-equipment-button"
            >
              <Plus size={16} />
              <span>Add Equipment Item</span>
            </button>
          </div>
      </div>
      )}

      {/* 2. ALERT FEEDBACK NOTICES */}
      {msg && (
        <div
          className={`alert-banner ${msg.type}`}
          style={{
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderRadius: 12,
            background: msg.type === "success" ? "var(--ok-bg)" : "var(--bad-bg)",
            color: msg.type === "success" ? "var(--ok-fg)" : "var(--bad-fg)",
            border: `1px solid ${msg.type === "success" ? "var(--ok-line)" : "var(--bad-line)"}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {msg.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span style={{ fontSize: 13, fontWeight: 600 }}>{msg.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setMsg(null)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.6 }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* 2. WORKSPACE SUBNAV (SCROLLABLE ON MOBILE) */}
      <div className="portal-subnav">
        <button
          type="button"
          className={activeTab === "catalog" ? "active" : ""}
          onClick={() => handleTabSelect("catalog")}
        >
          <Package size={15} />
          <span className="tab-label-long">{isPrincipal ? "Equipment Inventory" : "Available Equipment"} ({items.length})</span>
          <span className="tab-label-short">{isPrincipal ? "Inventory" : "Available"}</span>
        </button>

        {isPrincipal && (
          <button
            type="button"
            className={activeTab === "requests" ? "active" : ""}
            onClick={() => handleTabSelect("requests")}
          >
            <ShieldCheck size={15} />
            <span className="tab-label-long">Loan Approvals Queue</span>
            <span className="tab-label-short">Approvals</span>
            {pendingRequests.length > 0 && (
              <span
                style={{
                  background: "#d97706",
                  color: "white",
                  fontSize: 11,
                  fontWeight: 800,
                  padding: "1px 7px",
                  borderRadius: 999,
                  marginLeft: 4,
                }}
              >
                {pendingRequests.length}
              </span>
            )}
          </button>
        )}

        {isPrincipal && (
          <button
            type="button"
            className={activeTab === "active_loans" ? "active" : ""}
            onClick={() => handleTabSelect("active_loans")}
          >
            <Layers size={15} />
            <span className="tab-label-long">Active Loans in Field ({activeLoans.length})</span>
            <span className="tab-label-short">On Loan</span>
          </button>
        )}

        {!isPrincipal && (
          <button
            type="button"
            className={activeTab === "my_requests" ? "active" : ""}
            onClick={() => handleTabSelect("my_requests")}
          >
            <FileText size={15} />
            <span className="tab-label-long">My Borrow Requests ({myRequests.length})</span>
            <span className="tab-label-short">Mine</span>
          </button>
        )}
      </div>

      {/* 5. TAB 1: EQUIPMENT INVENTORY CATALOG */}
      {activeTab === "catalog" && (
        <div className="catalog-section">
          {/* SEARCH & FILTERS */}
          <div className="search-filter-bar">
            <div className="search-box">
              <Search size={16} style={{ opacity: 0.5 }} />
              <input
                type="text"
                placeholder="Search equipment by name, category, or notes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <CustomSelect
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={categoryFilterOptions}
              icon={<Filter size={14} />}
              ariaLabel="Filter equipment by category"
              variant="pill"
            />

            <CustomSelect
              value={statusFilter}
              onChange={(val) => setStatusFilter(val as "all" | "in_stock" | "out_of_stock" | "needs_repair")}
              options={statusFilterOptions}
              ariaLabel="Filter equipment by stock status"
              variant="pill"
            />
          </div>

          {filteredItems.length === 0 ? (
            <div
              style={{
                background: "var(--surface)",
                borderRadius: 18,
                padding: "48px 24px",
                textAlign: "center",
                border: "1px solid var(--line)",
              }}
            >
              <Package size={40} style={{ opacity: 0.3, margin: "0 auto 12px" }} />
              <h3 style={{ margin: "0 0 6px", font: "800 18px var(--font-display)" }}>No equipment found</h3>
              <p style={{ margin: 0, opacity: 0.65, fontSize: 13 }}>
                Try adjusting your search query or filter settings.
              </p>
            </div>
          ) : (
            <div className="equipment-grid">
              {filteredItems.map((item) => {
                const isAvailable = item.available_quantity > 0;
                const stockPct = Math.min(100, Math.round((item.available_quantity / Math.max(1, item.total_quantity)) * 100));

                return (
                  <div key={item.id} className="equipment-card">
                    <div>
                      <div className="equipment-card-header">
                        <span className="category-badge">{item.category}</span>
                        <span className={`condition-badge ${item.condition}`}>
                          {item.condition.replace("_", " ")}
                        </span>
                      </div>

                      <h3 style={{ margin: "0 0 6px", fontSize: 18 }}>{item.name}</h3>
                      <p className="equipment-card-desc" style={{ minHeight: 36, marginBottom: 14 }}>
                        {item.description || "Official UCL Hiking Club kit available for member loan."}
                      </p>
                    </div>

                    <div>
                      {/* Visual stock meter */}
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                          <span>
                            Stock: <strong>{item.available_quantity}</strong> / {item.total_quantity} available
                          </span>
                          <span
                            style={{
                              fontWeight: 700,
                              color: isAvailable ? "var(--ok-fg)" : "var(--bad-fg)",
                            }}
                          >
                            {isAvailable ? "In Stock" : "Checked Out"}
                          </span>
                        </div>
                        <div
                          style={{
                            height: 6,
                            background: "var(--surface-3)",
                            borderRadius: 999,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${stockPct}%`,
                              background: stockPct > 40 ? "#10b981" : stockPct > 0 ? "#f59e0b" : "#ef4444",
                              borderRadius: 999,
                            }}
                          />
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="equipment-card-actions" style={{ display: "flex", gap: "8px", flexDirection: "column" }}>
                        {!isPrincipal && (
                          <button
                            type="button"
                            disabled={!isAvailable}
                            onClick={() => {
                              setSelectedItem(item);
                              setBorrowQty(1);
                            }}
                            className="button primary compact full-width"
                          >
                            <Send size={13} style={{ marginRight: 5 }} />
                            <span>Request to Borrow</span>
                          </button>
                        )}

                        {isPrincipal && (
                          <div className="equipment-card-admin-actions" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: 4 }}>
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(item)}
                              aria-label={`Edit ${item.name}`}
                              title={`Edit ${item.name}`}
                              className="button compact"
                              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 12 }}
                            >
                              <Edit2 size={13} />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingItem(item)}
                              aria-label={`Delete ${item.name}`}
                              title={`Delete ${item.name}`}
                              className="button compact"
                              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 12, color: "var(--bad-fg)" }}
                            >
                              <Trash2 size={13} />
                              <span>Delete</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 6. TAB 2: COMMITTEE REVIEW QUEUE */}
      {activeTab === "requests" && isPrincipal && (
        <div className="committee-review-section">
          {/* REQUEST FILTER BAR */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
            <div style={{ display: "flex", gap: 8, overflowX: "auto", maxWidth: "100%", paddingBottom: 4 }}>
              {(["all", "pending", "approved", "returned", "rejected"] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setRequestStatusFilter(st)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                    border: requestStatusFilter === st ? "1px solid var(--forest)" : "1px solid var(--line)",
                    background: requestStatusFilter === st ? "var(--forest)" : "var(--surface)",
                    color: requestStatusFilter === st ? "white" : "var(--ink)",
                    cursor: "pointer",
                    textTransform: "capitalize",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {st === "all" ? "All Requests" : st}
                  {st === "pending" && pendingRequests.length > 0 && (
                    <span style={{ marginLeft: 6, opacity: 0.9 }}>({pendingRequests.length})</span>
                  )}
                </button>
              ))}
            </div>

            <span style={{ fontSize: 12, opacity: 0.65 }}>
              Showing {filteredRequests.length} {filteredRequests.length === 1 ? "request" : "requests"}
            </span>
          </div>

          {filteredRequests.length === 0 ? (
            <div
              style={{
                background: "var(--surface)",
                borderRadius: 18,
                padding: "48px 24px",
                textAlign: "center",
                border: "1px solid var(--line)",
              }}
            >
              <CheckCircle2 size={36} color="#16a34a" style={{ margin: "0 auto 12px" }} />
              <h3 style={{ margin: "0 0 6px", font: "800 18px var(--font-display)" }}>
                No requests matching &quot;{requestStatusFilter}&quot;
              </h3>
              <p style={{ margin: 0, opacity: 0.65, fontSize: 13 }}>
                All member gear borrowing requests have been processed.
              </p>
            </div>
          ) : (
            <>
              {/* DESKTOP TABLE VIEW */}
              <div className="desktop-table-view requests-table-wrapper">
                <table className="requests-table">
                  <thead>
                    <tr>
                      <th>Member Requester</th>
                      <th>Equipment Item</th>
                      <th>Qty</th>
                      <th>Dates</th>
                      <th>Purpose / Destination</th>
                      <th>Status</th>
                      <th>Committee Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((req) => (
                      <tr key={req.id}>
                        <td>
                          <strong>{req.member?.full_name || "Club Member"}</strong>
                          <br />
                          <small style={{ color: "var(--forest)", fontWeight: 600 }}>{req.member?.email}</small>
                          <br />
                          <small style={{ opacity: 0.6 }}>{req.member?.membership_tier || "standard"} member</small>
                        </td>
                        <td>
                          <strong>{req.equipment?.name || "Equipment item"}</strong>
                          <br />
                          <small style={{ opacity: 0.65 }}>{req.equipment?.category}</small>
                        </td>
                        <td>
                          <strong>{req.quantity}x</strong>
                        </td>
                        <td>
                          <small style={{ whiteSpace: "nowrap" }}>
                            {req.start_date} → {req.end_date}
                          </small>
                        </td>
                        <td>
                          <small style={{ maxWidth: 220, display: "block", lineHeight: 1.4 }}>
                            {req.purpose || "Weekend club trip"}
                          </small>
                          {req.notes && (
                            <small style={{ display: "block", color: "var(--warn-fg)", marginTop: 4 }}>
                              <strong>Note:</strong> {req.notes}
                            </small>
                          )}
                        </td>
                        <td>
                          <span className={`req-status ${req.status}`}>{req.status}</span>
                        </td>
                        <td className="actions-cell">
                          {req.status === "pending" && (
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                type="button"
                                onClick={() => handleUpdateStatus(req.id, "approved")}
                                className="btn-action approve"
                                title="Approve loan and reserve inventory stock"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => setRejectingRequestId(req.id)}
                                className="btn-action reject"
                                title="Decline request with feedback notes"
                              >
                                Decline
                              </button>
                            </div>
                          )}
                          {req.status === "approved" && (
                            <button
                              type="button"
                              onClick={() => handleUpdateStatus(req.id, "returned")}
                              className="btn-action return"
                              title="Mark equipment returned and restore available stock"
                            >
                              Mark Returned
                            </button>
                          )}
                          {req.status === "returned" && (
                            <span style={{ fontSize: 11, color: "var(--ok-fg)", fontWeight: 700 }}>
                              Returned to Locker
                            </span>
                          )}
                          {req.status === "rejected" && (
                            <span style={{ fontSize: 11, color: "var(--bad-fg)", fontWeight: 600 }}>
                              Declined
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* MOBILE CARD VIEW */}
              <div className="mobile-card-view">
                {filteredRequests.map((req) => (
                  <div key={req.id} className="mobile-request-card">
                    <div className="mobile-card-top">
                      <div>
                        <strong style={{ fontSize: 15 }}>{req.member?.full_name || "Club Member"}</strong>
                        <div style={{ fontSize: 12, color: "var(--forest)", fontWeight: 600 }}>
                          <a href={`mailto:${req.member?.email}`} style={{ color: "inherit", textDecoration: "none" }}>
                            {req.member?.email}
                          </a>
                        </div>
                        <span style={{ fontSize: 11, opacity: 0.65 }}>
                          {req.member?.membership_tier || "standard"} member
                        </span>
                      </div>
                      <span className={`req-status ${req.status}`}>{req.status}</span>
                    </div>

                    <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "10px 12px", fontSize: 12 }}>
                      <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: 3 }}>
                        {req.quantity}x {req.equipment?.name || "Equipment Item"}
                      </div>
                      <div style={{ opacity: 0.7, display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                        <Calendar size={12} />
                        <span>{req.start_date} → {req.end_date}</span>
                      </div>
                      {req.purpose && (
                        <div style={{ opacity: 0.8, fontStyle: "italic", lineHeight: 1.4 }}>
                          &ldquo;{req.purpose}&rdquo;
                        </div>
                      )}
                      {req.notes && (
                        <div style={{ marginTop: 6, color: "var(--warn-fg)", fontSize: 11 }}>
                          <strong>Committee Note:</strong> {req.notes}
                        </div>
                      )}
                    </div>

                    {req.status === "pending" && (
                      <div className="mobile-actions-row">
                        <button
                          type="button"
                          onClick={() => handleUpdateStatus(req.id, "approved")}
                          className="btn-action approve"
                        >
                          Approve Loan
                        </button>
                        <button
                          type="button"
                          onClick={() => setRejectingRequestId(req.id)}
                          className="btn-action reject"
                        >
                          Decline
                        </button>
                      </div>
                    )}

                    {req.status === "approved" && (
                      <div className="mobile-actions-row">
                        <button
                          type="button"
                          onClick={() => handleUpdateStatus(req.id, "returned")}
                          className="btn-action return"
                        >
                          Mark Returned
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 7. TAB 3: ACTIVE LOANS ROSTER (IN FIELD) */}
      {activeTab === "active_loans" && isPrincipal && (
        <div>
          <div style={{ marginBottom: 18 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 18, font: "800 18px var(--font-display)" }}>
              Equipment Currently in Field
            </h3>
            <p style={{ margin: 0, opacity: 0.65, fontSize: 13 }}>
              Gear actively checked out to club members. Check back in when items are returned to the kit cupboard.
            </p>
          </div>

          {activeLoans.length === 0 ? (
            <div
              style={{
                background: "var(--surface)",
                borderRadius: 18,
                padding: "48px 24px",
                textAlign: "center",
                border: "1px solid var(--line)",
              }}
            >
              <CheckCircle2 size={36} color="#16a34a" style={{ margin: "0 auto 12px" }} />
              <h3 style={{ margin: "0 0 6px", font: "800 18px var(--font-display)" }}>
                No equipment currently on loan
              </h3>
              <p style={{ margin: 0, opacity: 0.65, fontSize: 13 }}>
                All club gear is accounted for and stored in the equipment locker.
              </p>
            </div>
          ) : (
            <>
              {/* DESKTOP TABLE VIEW */}
              <div className="desktop-table-view requests-table-wrapper">
                <table className="requests-table">
                  <thead>
                    <tr>
                      <th>Borrower</th>
                      <th>Equipment</th>
                      <th>Qty</th>
                      <th>Return Due Date</th>
                      <th>Purpose / Destination</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeLoans.map((loan) => (
                      <tr key={loan.id}>
                        <td>
                          <strong>{loan.member?.full_name || "Club Member"}</strong>
                          <br />
                          <small style={{ color: "var(--forest)" }}>{loan.member?.email}</small>
                        </td>
                        <td>
                          <strong>{loan.equipment?.name || "Equipment item"}</strong>
                          <br />
                          <small style={{ opacity: 0.6 }}>{loan.equipment?.category}</small>
                        </td>
                        <td>
                          <strong>{loan.quantity}x</strong>
                        </td>
                        <td>
                          <span style={{ fontWeight: 700, color: "var(--ink)" }}>{loan.end_date}</span>
                          <br />
                          <small style={{ opacity: 0.6 }}>Since {loan.start_date}</small>
                        </td>
                        <td>
                          <small>{loan.purpose || "Weekend trip"}</small>
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(loan.id, "returned")}
                            className="btn-action return"
                            style={{ padding: "6px 12px", fontSize: 12 }}
                          >
                            Check Back In
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* MOBILE CARD VIEW */}
              <div className="mobile-card-view">
                {activeLoans.map((loan) => (
                  <div key={loan.id} className="mobile-request-card">
                    <div className="mobile-card-top">
                      <div>
                        <strong style={{ fontSize: 15 }}>{loan.member?.full_name || "Club Member"}</strong>
                        <div style={{ fontSize: 12, color: "var(--forest)", fontWeight: 600 }}>
                          <a href={`mailto:${loan.member?.email}`} style={{ color: "inherit", textDecoration: "none" }}>
                            {loan.member?.email}
                          </a>
                        </div>
                      </div>
                      <span className="req-status approved">ON LOAN</span>
                    </div>

                    <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "10px 12px", fontSize: 12 }}>
                      <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: 3 }}>
                        {loan.quantity}x {loan.equipment?.name || "Equipment Item"}
                      </div>
                      <div style={{ opacity: 0.75, marginBottom: 2 }}>
                        Due back: <strong>{loan.end_date}</strong> (out since {loan.start_date})
                      </div>
                      {loan.purpose && (
                        <div style={{ opacity: 0.8, fontStyle: "italic", marginTop: 4 }}>
                          &ldquo;{loan.purpose}&rdquo;
                        </div>
                      )}
                    </div>

                    <div className="mobile-actions-row">
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(loan.id, "returned")}
                        className="btn-action return"
                        style={{ padding: "10px 14px", fontSize: 13 }}
                      >
                        Check Back In (Return to Locker)
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 8. TAB 4: MY BORROW REQUESTS */}
      {activeTab === "my_requests" && (
        <div className="requests-section">
          {myRequests.length === 0 ? (
            <div className="empty-state" style={{ textAlign: "center", padding: "48px 24px", background: "var(--surface)", borderRadius: 18, border: "1px solid var(--line)" }}>
              <Package size={40} style={{ opacity: 0.3, margin: "0 auto 12px" }} />
              <h3 style={{ margin: "0 0 6px", font: "800 18px var(--font-display)" }}>No borrow requests filed</h3>
              <p style={{ margin: "0 0 16px", opacity: 0.65, fontSize: 13 }}>
                You haven&apos;t filed any equipment borrowing requests yet.
              </p>
              <button
                type="button"
                onClick={() => handleTabSelect("catalog")}
                className="button primary compact"
              >
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
                    <div style={{ marginTop: 12 }}>
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(req.id, "cancelled")}
                        className="button-link text-danger"
                      >
                        Cancel Request
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: BORROW REQUEST MODAL */}
      {selectedItem && (
        <Sheet onClose={() => setSelectedItem(null)} labelledBy="borrow-sheet">
            <h3 id="borrow-sheet">Request Kit: {selectedItem.name}</h3>
            <p>Specify dates and expedition purpose for committee review.</p>

            <form onSubmit={handleFileRequest}>
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                  Quantity Needed (Max {selectedItem.available_quantity}):
                </label>
                <input
                  type="number"
                  min={1}
                  max={selectedItem.available_quantity}
                  value={borrowQty}
                  onChange={(e) => setBorrowQty(parseInt(e.target.value) || 1)}
                  required
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}
                />
              </div>

              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-group">
                  <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Start Date:</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}
                  />
                </div>
                <div className="form-group">
                  <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Return Date:</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    required
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 18 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                  Borrowing Purpose / Hike Details:
                </label>
                <textarea
                  rows={3}
                  placeholder="Describe where and when you plan to use this equipment..."
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  required
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontFamily: "inherit" }}
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
        </Sheet>
      )}

      {/* MODAL 2: ADD EQUIPMENT MODAL (COMMITTEE) */}
      {showAddItemModal && (
        <Sheet onClose={() => setShowAddItemModal(false)} labelledBy="add-item-sheet">
            <h3 id="add-item-sheet">Add Equipment Item to Inventory</h3>
            <p>Create a new piece of club equipment in the master locker list.</p>

            <form onSubmit={handleCreateEquipment}>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Equipment Name:</label>
                <input
                  type="text"
                  placeholder="e.g. MSR Hubba Hubba 2-Person Tent"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  required
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Category:</label>
                <CustomSelect
                  value={newItemCategory}
                  onChange={setNewItemCategory}
                  options={EQUIPMENT_CATEGORY_OPTIONS}
                  variant="input"
                  ariaLabel="Select equipment category"
                />
              </div>

              <div className="form-group" style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Description &amp; Specifications:</label>
                <input
                  type="text"
                  placeholder="Short description, capacity or specifications"
                  value={newItemDesc}
                  onChange={(e) => setNewItemDesc(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}
                />
              </div>

              <div className="form-row" style={{ marginBottom: 12 }}>
                <div className="form-group">
                  <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Total Units:</label>
                  <input
                    type="number"
                    min={1}
                    value={newItemTotal}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 1;
                      setNewItemTotal(val);
                      if (newItemAvailable > val) setNewItemAvailable(val);
                    }}
                    required
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}
                  />
                </div>
                <div className="form-group">
                  <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Available in Locker:</label>
                  <input
                    type="number"
                    min={0}
                    max={newItemTotal}
                    value={newItemAvailable}
                    onChange={(e) => setNewItemAvailable(parseInt(e.target.value) || 0)}
                    required
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 18 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Kit Condition:</label>
                <CustomSelect
                  value={newItemCondition}
                  onChange={(val) =>
                    setNewItemCondition(val as "excellent" | "good" | "fair" | "needs_repair")
                  }
                  options={CONDITION_OPTIONS}
                  variant="input"
                  ariaLabel="Select kit condition"
                />
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
                  {submitting ? "Adding..." : "Add to Inventory"}
                </button>
              </div>
            </form>
        </Sheet>
      )}

      {/* MODAL 3: EDIT EQUIPMENT MODAL (COMMITTEE) */}
      {editingItem && (
        <Sheet onClose={() => setEditingItem(null)} labelledBy="edit-item-sheet">
            <h3 id="edit-item-sheet">Edit Equipment Item</h3>
            <p>Update stock levels, category, or condition status.</p>

            <form onSubmit={handleSaveEdit}>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Equipment Name:</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Category:</label>
                <CustomSelect
                  value={editCategory}
                  onChange={setEditCategory}
                  options={EQUIPMENT_CATEGORY_OPTIONS}
                  variant="input"
                  ariaLabel="Edit equipment category"
                />
              </div>

              <div className="form-group" style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Description:</label>
                <input
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}
                />
              </div>

              <div className="form-row" style={{ marginBottom: 12 }}>
                <div className="form-group">
                  <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Total Physical Units:</label>
                  <input
                    type="number"
                    min={1}
                    value={editTotal}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 1;
                      setEditTotal(val);
                      if (editAvailable > val) setEditAvailable(val);
                    }}
                    required
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}
                  />
                </div>
                <div className="form-group">
                  <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Available in Locker:</label>
                  <input
                    type="number"
                    min={0}
                    max={editTotal}
                    value={editAvailable}
                    onChange={(e) => setEditAvailable(parseInt(e.target.value) || 0)}
                    required
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 18 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Condition:</label>
                <CustomSelect
                  value={editCondition}
                  onChange={(val) =>
                    setEditCondition(val as "excellent" | "good" | "fair" | "needs_repair")
                  }
                  options={CONDITION_OPTIONS}
                  variant="input"
                  ariaLabel="Edit equipment condition"
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="button compact"
                >
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="button primary compact">
                  {submitting ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
        </Sheet>
      )}

      {/* MODAL 4: DELETE CONFIRMATION MODAL */}
      {deletingItem && (
        <Sheet onClose={() => setDeletingItem(null)} labelledBy="delete-item-sheet">
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--bad-fg)", marginBottom: 10 }}>
              <AlertTriangle size={24} />
              <h3 id="delete-item-sheet" style={{ margin: 0, color: "var(--bad-fg)" }}>Delete Equipment Item</h3>
            </div>
            <p>
              Are you sure you want to remove <strong>{deletingItem.name}</strong> from the equipment inventory? This
              action cannot be undone.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setDeletingItem(null)}
                className="button compact"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteEquipment}
                disabled={submitting}
                className="button compact"
                style={{ background: "#b91c1c", color: "white", borderColor: "#b91c1c" }}
              >
                {submitting ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
        </Sheet>
      )}

      {/* MODAL 5: REJECTION NOTES MODAL */}
      {rejectingRequestId && (
        <Sheet onClose={() => setRejectingRequestId(null)} labelledBy="decline-sheet">
            <h3 id="decline-sheet">Decline Equipment Request</h3>
            <p>Provide a reason or advice for the member so they know why the kit cannot be loaned.</p>
            <textarea
              rows={3}
              placeholder="e.g. This equipment is reserved for the upcoming Lake District expedition..."
              value={rejectionNotes}
              onChange={(e) => setRejectionNotes(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontFamily: "inherit", marginBottom: 18 }}
            />
            <div className="modal-actions">
              <button onClick={() => setRejectingRequestId(null)} className="button compact">
                Cancel
              </button>
              <button
                onClick={() => handleUpdateStatus(rejectingRequestId, "rejected", rejectionNotes)}
                className="button primary compact"
                style={{ background: "#b91c1c", borderColor: "#b91c1c" }}
              >
                Confirm Decline
              </button>
            </div>
        </Sheet>
      )}

      {/* MODAL 6: GOOGLE SHEETS WEBHOOK SETTINGS MODAL */}
      {showSettingsModal && (
        <Sheet onClose={() => setShowSettingsModal(false)} labelledBy="sheets-settings-sheet">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <h3 id="sheets-settings-sheet" style={{ margin: "0 0 4px" }}>Google Sheets Webhook Settings</h3>
                <p style={{ margin: 0, opacity: 0.65, fontSize: 13 }}>
                  Connect your Google Sheet for live two-way sync and automatic styling.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                style={{ background: "none", border: "none", cursor: "pointer", opacity: 0.6, padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 8,
                background: isConfigured ? "var(--ok-bg)" : "var(--warn-bg)",
                border: `1px solid ${isConfigured ? "var(--ok-line)" : "var(--warn-line)"}`,
                marginBottom: 16,
                fontSize: 12,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: isConfigured ? "#10b981" : "#f59e0b",
                }}
              />
              <span style={{ fontWeight: 600, color: isConfigured ? "var(--ok-fg)" : "var(--warn-fg)" }}>
                {isConfigured ? "Webhook Connected & Active" : "Webhook Not Configured"}
              </span>
            </div>

            <form onSubmit={handleSaveSettings}>
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                  Google Apps Script Webhook URL:
                </label>
                <input
                  type="url"
                  placeholder="https://script.google.com/macros/s/.../exec"
                  value={settingsWebhookUrl}
                  onChange={(e) => setSettingsWebhookUrl(e.target.value)}
                  required
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", boxSizing: "border-box" }}
                />
                <small style={{ display: "block", marginTop: 4, opacity: 0.65, fontSize: 11 }}>
                  Deployed from <code>google-apps-script/Code.gs</code> as Web App (Execute as: Me, Who has access: Anyone).
                </small>
              </div>

              <div className="form-group" style={{ marginBottom: 18 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                  Google Spreadsheet ID or URL (Optional):
                </label>
                <input
                  type="text"
                  placeholder="e.g. 1BxiMVs0XR... or full sheet URL"
                  value={settingsSheetId}
                  onChange={(e) => setSettingsSheetId(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", boxSizing: "border-box" }}
                />
              </div>

              <div
                style={{
                  background: "var(--ok-bg)",
                  border: "1px solid var(--ok-line)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  marginBottom: 16,
                  fontSize: 12,
                  color: "var(--ok-fg)",
                  lineHeight: 1.4,
                }}
              >
                <strong>💡 How to Ensure Styling Applies:</strong>
                <p style={{ margin: "4px 0 0" }}>
                  1. Copy the updated code from <code>google-apps-script/Code.gs</code> into your Apps Script editor.
                  <br />
                  2. Click <strong>Deploy &gt; Manage deployments &gt; Edit (pencil) &gt; Version: New version &gt; Deploy</strong>.
                  <br />
                  3. In Google Sheets, you can also click the top menu <strong>🌲 UCL Hiking &gt; 🎨 Apply All Club Styling</strong> at any time.
                </p>
              </div>

              <div className="modal-actions" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(false)}
                  className="button compact"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={syncingSheets || !settingsWebhookUrl}
                  onClick={() => {
                    handleSyncSheets("push");
                  }}
                  className="button compact"
                  style={{ background: "#1e3a2b", color: "white", borderColor: "#1e3a2b" }}
                  title="Immediately push inventory and format all 3 tabs with UCL club styling"
                >
                  {syncingSheets ? "Applying..." : "🎨 Push & Impose Styling"}
                </button>
                <button type="submit" disabled={savingSettings} className="button primary compact">
                  {savingSettings ? "Saving..." : "Save Webhook Settings"}
                </button>
              </div>
            </form>
        </Sheet>
      )}
    </div>
  );
}
