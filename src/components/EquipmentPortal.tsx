"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Package,
  Plus,
  FileSpreadsheet,
  Search,
  X,
} from "lucide-react";
import type { Equipment, EquipmentCondition, EquipmentRequest, EquipmentRequestStatus } from "@/lib/types";
import { Sheet } from "./Sheet";
import { readCache, writeCache } from "@/lib/client-cache";
import { useAppRefresh } from "@/lib/refresh";

type Tab = "catalog" | "requests" | "active_loans" | "my_requests";
type StockFilter = "all" | "in_stock" | "out_of_stock" | "needs_repair";
type RequestFilter = "pending" | "approved" | "returned" | "rejected" | "all";
type Message = { type: "success" | "error"; text: string };

const CATEGORIES = [
  "Tents & Shelter",
  "Footwear & Boots",
  "Rucksacks & Bags",
  "Navigation & Safety",
  "Cooking & Stoves",
  "Sleeping Gear",
  "General & Other",
];

const CONDITION_LABELS: Record<EquipmentCondition, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  needs_repair: "Needs repair",
};

const STATUS_LABELS: Record<EquipmentRequestStatus, string> = {
  pending: "Pending",
  approved: "On loan",
  rejected: "Declined",
  returned: "Returned",
  cancelled: "Cancelled",
};

const STOCK_FILTERS: { value: StockFilter; label: string; test: (item: Equipment) => boolean }[] = [
  { value: "all", label: "All", test: () => true },
  { value: "in_stock", label: "In stock", test: (item) => item.available_quantity > 0 },
  { value: "out_of_stock", label: "Out", test: (item) => item.available_quantity === 0 },
  { value: "needs_repair", label: "Needs repair", test: (item) => item.condition === "needs_repair" },
];

const REQUEST_FILTERS: { value: RequestFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "On loan" },
  { value: "returned", label: "Returned" },
  { value: "rejected", label: "Declined" },
  { value: "all", label: "All" },
];

const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again.";

const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** "3–5 Oct", "30 Sept – 2 Oct": the month once when both ends share it. */
function formatRange(start: string, end: string): string {
  // Plain YYYY-MM-DD: read as local days, not UTC midnight.
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return `${start} – ${end}`;
  if (start === end) return shortDate.format(from);
  if (start.slice(0, 7) === end.slice(0, 7)) return `${from.getDate()}–${shortDate.format(to)}`;
  return `${shortDate.format(from)} – ${shortDate.format(to)}`;
}

/** Today as YYYY-MM-DD in the phone's own time zone, for date inputs and due dates. */
function localToday(): string {
  return new Date().toLocaleDateString("en-CA");
}

interface ItemDraft {
  id?: string;
  name: string;
  category: string;
  description: string;
  total: number;
  available: number;
  condition: EquipmentCondition;
}

const BLANK_ITEM: ItemDraft = {
  name: "",
  category: CATEGORIES[0],
  description: "",
  total: 2,
  available: 2,
  condition: "good",
};

interface BorrowDraft {
  item: Equipment;
  quantity: number;
  start: string;
  end: string;
  purpose: string;
}

interface EquipmentPortalProps {
  memberId: string;
  /** Principals manage the kit and review loans; everyone else here borrows it. */
  isPrincipal: boolean;
  initialTab?: Tab | "committee_review";
  onTabChange?: (tab: Tab) => void;
}

/**
 * The equipment locker. Borrowers browse what is in and ask for it; principals
 * keep the inventory, work through the request queue and check kit back in.
 *
 * Every list is a single hairline-ruled column that reads the same on a phone
 * and a laptop, so there is one layout to maintain rather than a table and a
 * card view kept in step.
 */
const EQUIPMENT_CACHE_KEY = "equipment";
type EquipmentCache = { items: Equipment[]; requests: EquipmentRequest[] };

export function EquipmentPortal({ memberId, isPrincipal, initialTab = "catalog", onTabChange }: EquipmentPortalProps) {
  const [internalTab, setInternalTab] = useState<Tab>(initialTab === "committee_review" ? "requests" : initialTab);
  const tab = onTabChange ? (initialTab === "committee_review" ? "requests" : initialTab) : internalTab;
  const selectTab = (next: Tab) => {
    setInternalTab(next);
    onTabChange?.(next);
  };

  const [cached] = useState(() => readCache<EquipmentCache>(EQUIPMENT_CACHE_KEY));
  const [items, setItems] = useState<Equipment[]>(cached?.items ?? []);
  const [requests, setRequests] = useState<EquipmentRequest[]>(cached?.requests ?? []);
  const [loaded, setLoaded] = useState(Boolean(cached));
  const [today, setToday] = useState(cached ? localToday() : "");
  const [msg, setMsg] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [stock, setStock] = useState<StockFilter>("all");
  const [requestFilter, setRequestFilter] = useState<RequestFilter>("pending");

  const [borrow, setBorrow] = useState<BorrowDraft | null>(null);
  const [itemDraft, setItemDraft] = useState<ItemDraft | null>(null);
  const [deleting, setDeleting] = useState<Equipment | null>(null);
  const [declining, setDeclining] = useState<EquipmentRequest | null>(null);
  const [declineNotes, setDeclineNotes] = useState("");

  const [showSheets, setShowSheets] = useState(false);
  const [sheetsUrl, setSheetsUrl] = useState("");
  const [sheetsId, setSheetsId] = useState("");
  const [sheetsConfigured, setSheetsConfigured] = useState(false);
  const [syncing, setSyncing] = useState<"push" | "pull" | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [eqRes, reqRes] = await Promise.all([
        fetch("/api/equipment", { signal }),
        fetch("/api/equipment/requests", { signal }),
      ]);
      const [eqData, reqData] = await Promise.all([
        eqRes.ok ? eqRes.json() : null,
        reqRes.ok ? reqRes.json() : null,
      ]);
      if (signal?.aborted) return;
      if (eqData) setItems(eqData.equipment ?? []);
      if (reqData) setRequests(reqData.requests ?? []);
      if (eqData && reqData) {
        writeCache<EquipmentCache>(EQUIPMENT_CACHE_KEY, { items: eqData.equipment ?? [], requests: reqData.requests ?? [] });
      }
      if (!eqRes.ok || !reqRes.ok) setMsg({ type: "error", text: "Couldn't load all of the equipment. Pull down to try again." });
    } catch {
      if (!signal?.aborted) setMsg({ type: "error", text: NETWORK_ERROR });
    } finally {
      if (!signal?.aborted) {
        setToday(localToday());
        setLoaded(true);
      }
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
    if (!isPrincipal) return;
    fetch("/api/equipment/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setSheetsUrl(d.webhookUrl || "");
        setSheetsId(d.sheetId || "");
        setSheetsConfigured(Boolean(d.configured));
      })
      .catch(() => {});
  }, [isPrincipal]);

  // Confirmations clear themselves; errors wait to be read and dismissed.
  useEffect(() => {
    if (msg?.type !== "success") return;
    const timer = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [msg]);

  /** Send a JSON request, reporting failure in the toast. Resolves to the body, or null if it failed. */
  async function send(url: string, method: string, body: unknown, failure: string) {
    setMsg(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ type: "error", text: data.error || failure });
        return null;
      }
      return data;
    } catch {
      setMsg({ type: "error", text: NETWORK_ERROR });
      return null;
    }
  }

  async function submitBorrow(event: FormEvent) {
    event.preventDefault();
    if (!borrow) return;
    setBusy(true);
    const data = await send(
      "/api/equipment/requests",
      "POST",
      {
        equipmentId: borrow.item.id,
        quantity: borrow.quantity,
        startDate: borrow.start,
        endDate: borrow.end,
        purpose: borrow.purpose,
      },
      "Couldn't send the request",
    );
    setBusy(false);
    if (!data) return;
    setMsg({ type: "success", text: `Asked to borrow ${borrow.item.name}` });
    setBorrow(null);
    selectTab("my_requests");
    void load();
  }

  async function updateStatus(request: EquipmentRequest, status: EquipmentRequestStatus, notes?: string) {
    setBusy(true);
    const data = await send(`/api/equipment/requests/${request.id}`, "PATCH", { status, notes }, "Couldn't update the request");
    setBusy(false);
    if (!data) return;
    const name = request.equipment?.name ?? "Kit";
    const text =
      status === "approved"
        ? `Approved — ${name} is on loan`
        : status === "returned"
          ? `${name} checked back in`
          : status === "rejected"
            ? "Request declined"
            : "Request cancelled";
    setMsg({ type: "success", text });
    setDeclining(null);
    setDeclineNotes("");
    void load();
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    if (!itemDraft || !itemDraft.name.trim()) return;
    setBusy(true);
    const data = await send(
      "/api/equipment",
      "POST",
      {
        id: itemDraft.id,
        name: itemDraft.name.trim(),
        category: itemDraft.category,
        description: itemDraft.description.trim() || undefined,
        totalQuantity: itemDraft.total,
        availableQuantity: Math.min(itemDraft.available, itemDraft.total),
        condition: itemDraft.condition,
      },
      itemDraft.id ? "Couldn't save the changes" : "Couldn't add the item",
    );
    setBusy(false);
    if (!data) return;
    setMsg({ type: "success", text: itemDraft.id ? `Saved ${itemDraft.name.trim()}` : `Added ${itemDraft.name.trim()}` });
    setItemDraft(null);
    void load();
  }

  async function deleteItem() {
    if (!deleting) return;
    setBusy(true);
    const data = await send("/api/equipment", "DELETE", { id: deleting.id }, "Couldn't delete the item");
    setBusy(false);
    if (!data) return;
    setMsg({ type: "success", text: `Removed ${deleting.name}` });
    setDeleting(null);
    void load();
  }

  async function syncSheets(direction: "push" | "pull") {
    setSyncing(direction);
    const data = await send(
      "/api/equipment/sync-sheets",
      "POST",
      { direction },
      direction === "pull" ? "Couldn't import from Google Sheets" : "Couldn't push to Google Sheets",
    );
    setSyncing(null);
    if (!data) return;
    if (direction === "pull") {
      setMsg({ type: "success", text: data.message || `Imported ${data.importedCount} items from Google Sheets` });
      void load();
    } else if (data.webhookDelivered) {
      setMsg({ type: "success", text: data.message || `Pushed ${data.equipmentCount} items to Google Sheets` });
    } else {
      setMsg({
        type: "error",
        text: data.message || "The sheet didn't accept the push. Check the webhook URL and that the script is deployed.",
      });
    }
  }

  async function saveSheetsSettings(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const data = await send(
      "/api/equipment/settings",
      "POST",
      { webhookUrl: sheetsUrl, sheetId: sheetsId },
      "Couldn't save the Google Sheets settings",
    );
    setBusy(false);
    if (!data) return;
    setSheetsConfigured(Boolean(sheetsUrl.trim()));
    setShowSheets(false);
    setMsg({ type: "success", text: "Google Sheets connected" });
  }

  function openBorrow(item: Equipment) {
    const start = localToday();
    setBorrow({ item, quantity: 1, start, end: start, purpose: "" });
  }

  const pending = useMemo(() => requests.filter((r) => r.status === "pending"), [requests]);
  const onLoan = useMemo(() => requests.filter((r) => r.status === "approved"), [requests]);
  const mine = useMemo(() => requests.filter((r) => r.member_id === memberId), [requests, memberId]);

  const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category))).sort(), [items]);

  const query = search.trim().toLowerCase();
  const searched = useMemo(
    () =>
      items.filter(
        (item) =>
          (category === "all" || item.category === category) &&
          (!query ||
            item.name.toLowerCase().includes(query) ||
            item.category.toLowerCase().includes(query) ||
            (item.description?.toLowerCase().includes(query) ?? false)),
      ),
    [items, category, query],
  );
  const stockTest = STOCK_FILTERS.find((f) => f.value === stock)!.test;
  const visibleItems = searched.filter(stockTest);

  const requestCounts = useMemo(() => {
    const counts = { all: requests.length } as Record<RequestFilter, number>;
    for (const { value } of REQUEST_FILTERS) if (value !== "all") counts[value] = requests.filter((r) => r.status === value).length;
    return counts;
  }, [requests]);
  const visibleRequests = requestFilter === "all" ? requests : requests.filter((r) => r.status === requestFilter);

  if (!loaded) {
    return (
      <div className="kit-page" aria-busy="true">
        <p className="sr-only" role="status">Loading equipment…</p>
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

  const tabs: { value: Tab; label: string; count?: number; alert?: boolean }[] = isPrincipal
    ? [
        { value: "catalog", label: "Inventory", count: items.length },
        { value: "requests", label: "Requests", count: pending.length, alert: pending.length > 0 },
        { value: "active_loans", label: "On loan", count: onLoan.length },
      ]
    : [
        { value: "catalog", label: "Available", count: items.filter((i) => i.available_quantity > 0).length },
        { value: "my_requests", label: "Mine", count: mine.length },
      ];

  return (
    <div className="kit-page">
      <div className="portal-subnav kit-tabs" role="tablist" aria-label="Equipment">
        {tabs.map(({ value, label, count, alert }) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "active" : ""}
            onClick={() => selectTab(value)}
          >
            {label}
            {count ? <span className={`kit-count${alert ? " is-alert" : ""}`}>{count}</span> : null}
          </button>
        ))}
      </div>

      {tab === "catalog" && (
        <section aria-label={isPrincipal ? "Inventory" : "Available equipment"}>
          <div className="kit-toolbar">
            <label className="roster-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                inputMode="search"
                autoComplete="off"
                placeholder="Search kit"
                aria-label="Search equipment"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} aria-label="Clear search">
                  <X size={15} />
                </button>
              )}
            </label>
            {isPrincipal && (
              <>
                <button
                  type="button"
                  className="kit-icon-btn"
                  onClick={() => setShowSheets(true)}
                  aria-label={sheetsConfigured ? "Google Sheets sync" : "Google Sheets sync (not set up)"}
                  title="Google Sheets sync"
                >
                  <FileSpreadsheet size={18} aria-hidden="true" />
                  {!sheetsConfigured && <span className="kit-dot" aria-hidden="true" />}
                </button>
                <button type="button" className="kit-btn primary" onClick={() => setItemDraft(BLANK_ITEM)}>
                  <Plus size={16} aria-hidden="true" />
                  Add
                </button>
              </>
            )}
          </div>

          {items.length > 0 && (
          <div className="roster-filters kit-filters" role="group" aria-label="Filter equipment">
            {categories.length > 1 && (
              <select
                className={`kit-chip-select${category !== "all" ? " active" : ""}`}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="Category"
              >
                <option value="all">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            {STOCK_FILTERS.map(({ value, label, test }) => {
              const count = searched.filter(test).length;
              // A filter that would show nothing is noise, unless it is the one selected.
              if (value !== "all" && count === 0 && stock !== value) return null;
              return (
                <button
                  key={value}
                  type="button"
                  className={stock === value ? "active" : ""}
                  aria-pressed={stock === value}
                  onClick={() => setStock(value)}
                >
                  {label}
                  <span className="roster-filter-count">{count}</span>
                </button>
              );
            })}
          </div>
          )}

          {visibleItems.length === 0 ? (
            <Empty icon={<Package size={28} aria-hidden="true" />}>
              {items.length === 0
                ? isPrincipal
                  ? "Nothing in the inventory yet. Add the first item, or pull it in from Google Sheets."
                  : "The principals haven't listed any kit yet."
                : "No kit matches. Try another search or filter."}
            </Empty>
          ) : (
            <ul className="kit-list">
              {visibleItems.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  isPrincipal={isPrincipal}
                  onBorrow={() => openBorrow(item)}
                  onEdit={() =>
                    setItemDraft({
                      id: item.id,
                      name: item.name,
                      category: item.category,
                      description: item.description ?? "",
                      total: item.total_quantity,
                      available: item.available_quantity,
                      condition: item.condition,
                    })
                  }
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "requests" && isPrincipal && (
        <section aria-label="Requests">
          <div className="roster-filters kit-filters" role="group" aria-label="Filter requests">
            {REQUEST_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={requestFilter === value ? "active" : ""}
                aria-pressed={requestFilter === value}
                onClick={() => setRequestFilter(value)}
              >
                {label}
                <span className="roster-filter-count">{requestCounts[value]}</span>
              </button>
            ))}
          </div>
          {visibleRequests.length === 0 ? (
            <Empty icon={<CheckCircle2 size={28} aria-hidden="true" />}>
              {requestFilter === "pending" ? "Nothing waiting for a decision." : "No requests here."}
            </Empty>
          ) : (
            <ul className="kit-list">
              {visibleRequests.map((request) => (
                <RequestRow
                  key={request.id}
                  request={request}
                  view="committee"
                  today={today}
                  actions={
                    request.status === "pending" ? (
                      <>
                        <button type="button" className="kit-btn" disabled={busy} onClick={() => setDeclining(request)}>
                          Decline
                        </button>
                        <button
                          type="button"
                          className="kit-btn primary"
                          disabled={busy}
                          onClick={() => updateStatus(request, "approved")}
                        >
                          Approve
                        </button>
                      </>
                    ) : request.status === "approved" ? (
                      <button type="button" className="kit-btn" disabled={busy} onClick={() => updateStatus(request, "returned")}>
                        Check in
                      </button>
                    ) : null
                  }
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "active_loans" && isPrincipal && (
        <section aria-label="On loan">
          {onLoan.length === 0 ? (
            <Empty icon={<CheckCircle2 size={28} aria-hidden="true" />}>Nothing is out. All the kit is in the locker.</Empty>
          ) : (
            <ul className="kit-list">
              {[...onLoan]
                .sort((a, b) => a.end_date.localeCompare(b.end_date))
                .map((loan) => (
                  <RequestRow
                    key={loan.id}
                    request={loan}
                    view="committee"
                    today={today}
                    actions={
                      <button type="button" className="kit-btn" disabled={busy} onClick={() => updateStatus(loan, "returned")}>
                        Check in
                      </button>
                    }
                  />
                ))}
            </ul>
          )}
        </section>
      )}

      {tab === "my_requests" && (
        <section aria-label="Your requests">
          {mine.length === 0 ? (
            <Empty icon={<Package size={28} aria-hidden="true" />}>
              You haven&apos;t asked to borrow anything yet.
              <button type="button" className="kit-btn" onClick={() => selectTab("catalog")}>
                Browse kit
              </button>
            </Empty>
          ) : (
            <ul className="kit-list">
              {mine.map((request) => (
                <RequestRow
                  key={request.id}
                  request={request}
                  view="mine"
                  today={today}
                  actions={
                    request.status === "pending" ? (
                      <button
                        type="button"
                        className="kit-btn danger-text"
                        disabled={busy}
                        onClick={() => updateStatus(request, "cancelled")}
                      >
                        Cancel request
                      </button>
                    ) : null
                  }
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {msg && (
        <div className={`kit-toast is-${msg.type}`} role={msg.type === "error" ? "alert" : "status"}>
          {msg.type === "success" ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertCircle size={18} aria-hidden="true" />}
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}

      {borrow && (
        <Sheet onClose={() => setBorrow(null)} labelledBy="borrow-sheet">
          <h3 id="borrow-sheet">Borrow {borrow.item.name}</h3>
          <p>A principal will approve it and arrange handover.</p>
          <form className="kit-form" onSubmit={submitBorrow}>
            {borrow.item.available_quantity > 1 && (
              <Field label={`How many (up to ${borrow.item.available_quantity})`}>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={borrow.item.available_quantity}
                  value={borrow.quantity}
                  onChange={(e) => setBorrow({ ...borrow, quantity: parseInt(e.target.value) || 1 })}
                  required
                />
              </Field>
            )}
            <div className="kit-form-row">
              <Field label="From">
                <input
                  type="date"
                  min={today}
                  value={borrow.start}
                  onChange={(e) =>
                    setBorrow({ ...borrow, start: e.target.value, end: borrow.end < e.target.value ? e.target.value : borrow.end })
                  }
                  required
                />
              </Field>
              <Field label="Back by">
                <input
                  type="date"
                  min={borrow.start}
                  value={borrow.end}
                  onChange={(e) => setBorrow({ ...borrow, end: e.target.value })}
                  required
                />
              </Field>
            </div>
            <Field label="What's it for?">
              <textarea
                rows={2}
                placeholder="e.g. Snowdon weekend, 2 nights camping"
                value={borrow.purpose}
                onChange={(e) => setBorrow({ ...borrow, purpose: e.target.value })}
                required
              />
            </Field>
            <div className="modal-actions">
              <button type="button" className="kit-btn" onClick={() => setBorrow(null)}>
                Cancel
              </button>
              <button type="submit" className="kit-btn primary" disabled={busy}>
                {busy ? "Sending…" : "Send request"}
              </button>
            </div>
          </form>
        </Sheet>
      )}

      {itemDraft && (
        <Sheet onClose={() => setItemDraft(null)} labelledBy="item-sheet">
          <h3 id="item-sheet">{itemDraft.id ? "Edit item" : "Add item"}</h3>
          <form className="kit-form" onSubmit={saveItem}>
            <Field label="Name">
              <input
                type="text"
                placeholder="e.g. MSR Hubba Hubba 2-person tent"
                value={itemDraft.name}
                onChange={(e) => setItemDraft({ ...itemDraft, name: e.target.value })}
                required
              />
            </Field>
            <div className="kit-form-row is-wide-first">
              <Field label="Category">
                <select value={itemDraft.category} onChange={(e) => setItemDraft({ ...itemDraft, category: e.target.value })}>
                  {(CATEGORIES.includes(itemDraft.category) ? CATEGORIES : [itemDraft.category, ...CATEGORIES]).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Condition">
                <select
                  value={itemDraft.condition}
                  onChange={(e) => setItemDraft({ ...itemDraft, condition: e.target.value as EquipmentCondition })}
                >
                  {(Object.keys(CONDITION_LABELS) as EquipmentCondition[]).map((c) => (
                    <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Notes">
              <input
                type="text"
                placeholder="Size, capacity, what's in the bag"
                value={itemDraft.description}
                onChange={(e) => setItemDraft({ ...itemDraft, description: e.target.value })}
              />
            </Field>
            <div className="kit-form-row">
              <Field label="Total owned">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={itemDraft.total}
                  onChange={(e) => {
                    const total = parseInt(e.target.value) || 1;
                    setItemDraft({ ...itemDraft, total, available: Math.min(itemDraft.available, total) });
                  }}
                  required
                />
              </Field>
              <Field label="In the locker">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={itemDraft.total}
                  value={itemDraft.available}
                  onChange={(e) => setItemDraft({ ...itemDraft, available: parseInt(e.target.value) || 0 })}
                  required
                />
              </Field>
            </div>
            {itemDraft.id && (
              <button
                type="button"
                className="kit-btn danger-text kit-delete-link"
                onClick={() => {
                  const item = items.find((i) => i.id === itemDraft.id);
                  setItemDraft(null);
                  if (item) setDeleting(item);
                }}
              >
                Delete this item…
              </button>
            )}
            <div className="modal-actions">
              <button type="button" className="kit-btn" onClick={() => setItemDraft(null)}>
                Cancel
              </button>
              <button type="submit" className="kit-btn primary" disabled={busy}>
                {busy ? "Saving…" : itemDraft.id ? "Save" : "Add item"}
              </button>
            </div>
          </form>
        </Sheet>
      )}

      {deleting && (
        <Sheet onClose={() => setDeleting(null)} labelledBy="delete-sheet">
          <h3 id="delete-sheet">Delete {deleting.name}?</h3>
          <p>It comes off the inventory for good. This can&apos;t be undone.</p>
          <div className="modal-actions">
            <button type="button" className="kit-btn" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button type="button" className="kit-btn danger" onClick={deleteItem} disabled={busy}>
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Sheet>
      )}

      {declining && (
        <Sheet onClose={() => setDeclining(null)} labelledBy="decline-sheet">
          <h3 id="decline-sheet">Decline request</h3>
          <p>
            {declining.member?.full_name ?? "The member"} asked for {declining.quantity}× {declining.equipment?.name ?? "kit"}.
            Say why, so they know what to do instead.
          </p>
          <form
            className="kit-form"
            onSubmit={(e) => {
              e.preventDefault();
              void updateStatus(declining, "rejected", declineNotes);
            }}
          >
            <Field label="Reason (optional)">
              <textarea
                rows={3}
                placeholder="e.g. Reserved for the Lake District trip that weekend"
                value={declineNotes}
                onChange={(e) => setDeclineNotes(e.target.value)}
              />
            </Field>
            <div className="modal-actions">
              <button type="button" className="kit-btn" onClick={() => setDeclining(null)}>
                Cancel
              </button>
              <button type="submit" className="kit-btn danger" disabled={busy}>
                Decline
              </button>
            </div>
          </form>
        </Sheet>
      )}

      {showSheets && (
        <Sheet onClose={() => setShowSheets(false)} labelledBy="sheets-sheet">
          <h3 id="sheets-sheet">Google Sheets</h3>
          <p className={`kit-sheets-status${sheetsConfigured ? " is-on" : ""}`}>
            <span className="kit-status-dot" aria-hidden="true" />
            {sheetsConfigured ? "Connected" : "Not connected yet"}
          </p>
          <div className="kit-sheets-actions">
            <button
              type="button"
              className="kit-btn"
              disabled={!sheetsConfigured || syncing !== null}
              onClick={() => syncSheets("push")}
            >
              {syncing === "push" && <Loader2 size={15} className="roster-spinner" aria-hidden="true" />}
              Push to sheet
            </button>
            <button
              type="button"
              className="kit-btn"
              disabled={!sheetsConfigured || syncing !== null}
              onClick={() => syncSheets("pull")}
            >
              {syncing === "pull" && <Loader2 size={15} className="roster-spinner" aria-hidden="true" />}
              Pull from sheet
            </button>
          </div>
          <form className="kit-form" onSubmit={saveSheetsSettings}>
            <Field label="Apps Script web app URL">
              <input
                type="url"
                inputMode="url"
                placeholder="https://script.google.com/macros/s/…/exec"
                value={sheetsUrl}
                onChange={(e) => setSheetsUrl(e.target.value)}
                required
              />
            </Field>
            <Field label="Spreadsheet ID or URL (optional)">
              <input type="text" value={sheetsId} onChange={(e) => setSheetsId(e.target.value)} />
            </Field>
            <details className="kit-help">
              <summary>How to set it up</summary>
              <ol>
                <li>
                  Paste <code>google-apps-script/Code.gs</code> into the sheet&apos;s Apps Script editor.
                </li>
                <li>Deploy it as a web app (execute as you, anyone can access) and copy the URL here.</li>
                <li>
                  After editing the script, deploy a new version: Deploy › Manage deployments › Edit › New version.
                </li>
                <li>
                  In the sheet, <strong>UCL Hiking › Apply Club Brand Styling &amp; Formulas</strong> reapplies the styling.
                </li>
              </ol>
            </details>
            <div className="modal-actions">
              <button type="button" className="kit-btn" onClick={() => setShowSheets(false)}>
                Close
              </button>
              <button type="submit" className="kit-btn primary" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Sheet>
      )}
    </div>
  );
}

function ItemRow({
  item,
  isPrincipal,
  onBorrow,
  onEdit,
}: {
  item: Equipment;
  isPrincipal: boolean;
  onBorrow: () => void;
  onEdit: () => void;
}) {
  const ratio = item.available_quantity / Math.max(1, item.total_quantity);
  const level = item.available_quantity === 0 ? "is-out" : ratio < 0.4 ? "is-low" : "";
  const flagged = item.condition === "fair" || item.condition === "needs_repair";

  const summary = (
    <>
      <span className="kit-item-name">{item.name}</span>
      <span className="kit-item-meta">
        {item.category}
        {flagged && <span className={`kit-tag is-${item.condition}`}>{CONDITION_LABELS[item.condition]}</span>}
      </span>
      {item.description && <span className="kit-item-desc">{item.description}</span>}
    </>
  );

  return (
    <li className="kit-item">
      {isPrincipal ? (
        <button type="button" className="kit-item-main" onClick={onEdit} aria-label={`Edit ${item.name}`}>
          {summary}
        </button>
      ) : (
        <div className="kit-item-main">{summary}</div>
      )}
      <span className={`kit-stock ${level}`} aria-label={`${item.available_quantity} of ${item.total_quantity} available`}>
        <strong>{item.available_quantity}</strong>/{item.total_quantity}
      </span>
      {isPrincipal ? (
        <ChevronRight className="kit-item-chevron" size={18} aria-hidden="true" />
      ) : (
        <button type="button" className="kit-btn primary" disabled={item.available_quantity === 0} onClick={onBorrow}>
          Borrow
        </button>
      )}
    </li>
  );
}

function RequestRow({
  request,
  view,
  today,
  actions,
}: {
  request: EquipmentRequest;
  view: "committee" | "mine";
  today: string;
  actions: ReactNode;
}) {
  const item = request.equipment?.name ?? "Equipment item";
  const overdue = request.status === "approved" && today !== "" && request.end_date < today;

  return (
    <li className="kit-request">
      <div className="kit-request-body">
        <div className="kit-request-head">
          <strong>{view === "committee" ? request.member?.full_name || "Club member" : item}</strong>
          <span className={`kit-tag is-${overdue ? "overdue" : request.status}`}>
            {overdue ? "Overdue" : STATUS_LABELS[request.status]}
          </span>
        </div>
        <p className="kit-request-meta">
          {view === "committee" ? (
            <>
              {request.quantity}× {item} · {formatRange(request.start_date, request.end_date)}
            </>
          ) : (
            <>
              {request.quantity > 1 ? `${request.quantity}× · ` : ""}
              {formatRange(request.start_date, request.end_date)}
            </>
          )}
        </p>
        {request.purpose && <p className="kit-request-purpose">{request.purpose}</p>}
        {request.notes && <p className="kit-request-note">{request.notes}</p>}
        {view === "committee" && request.member?.email && (
          <a className="kit-request-email" href={`mailto:${request.member.email}`}>
            {request.member.email}
          </a>
        )}
      </div>
      {actions ? <div className="kit-request-actions">{actions}</div> : null}
    </li>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="kit-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="events-empty kit-empty">
      {icon}
      <p>{children}</p>
    </div>
  );
}
