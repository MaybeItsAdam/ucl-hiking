"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Capacitor } from "@capacitor/core";
import { useSearchParams } from "next/navigation";
import type { BatchOpResult, ItemSummary, TagLookup } from "@/lib/equipmentItems";
import { MAX_BATCH_OPS } from "@/lib/equipmentItems";
import { fetchWithin } from "@/lib/fetchWithin";
import {
  chunk,
  enqueue,
  isPendingItem,
  looksOffline,
  mergeAfterFlush,
  previewScan,
  projectQueue,
  readQueue,
  settleQueue,
  writeQueue,
  type BatchOp,
  type QueuedScan,
  type SettledFailure,
} from "@/lib/kitScan";
import { nfcAvailability, startScanning, type NfcAvailability, type ScanSession } from "@/lib/nfc";
import type { ConditionReport } from "@/lib/kitReports";
import type { Equipment, EquipmentRequest } from "@/lib/types";
import { Sheet } from "../Sheet";
import { AuditMode } from "./AuditMode";
import { HandoverSheet } from "./HandoverSheet";
import { ScanSheet } from "./ScanSheet";

/**
 * Everything a kit lender does with tagged kit: scanning, the item card,
 * tagging new items, handover against a request, the shelf audit, and the
 * offline queue that holds scans until there is signal again.
 *
 * EquipmentPortal wraps its page in this provider; the buttons and the items
 * list read it through useKit(), and the one open sheet is drawn here. For
 * anyone who isn't a lender it renders its children and nothing else.
 */

export type LenderRequest = EquipmentRequest;

/** What a scan or an action came to. */
export type Outcome =
  | { kind: "ok"; result: Omit<BatchOpResult, "clientId" | "ok"> }
  | { kind: "error"; error: string; unregistered?: boolean; uid?: string }
  /**
   * Saved on the phone to send later. `item` is the item as it will be once
   * sent; `warning` says why the server may refuse it, judged on what the
   * phone last saw.
   */
  | { kind: "queued"; item?: ItemSummary; warning?: string };

export type ItemView = { item: ItemSummary; loan?: TagLookup["loan"]; offline?: boolean };

type View =
  | { kind: "scan" }
  | ({ kind: "item" } & ItemView)
  | { kind: "new"; uid: string; offline?: boolean }
  | { kind: "audit" }
  | { kind: "handover"; requestId: string };

export interface ScanState {
  active: boolean;
  continuous: boolean;
  error: string | null;
}

type OpBody = BatchOp extends infer T ? (T extends BatchOp ? Omit<T, "clientId" | "at"> : never) : never;

interface KitContext {
  /** Every tagged item, with the scans still waiting to send already applied. */
  items: ItemSummary[];
  /** Check-outs waiting to send, per request id. */
  queuedOut: Map<string, number>;
  itemsLoaded: boolean;
  equipment: Equipment[];
  requests: LenderRequest[];
  /** Open problem reports from borrowers (empty until the migration has run). */
  reports: ConditionReport[];
  /** Reload the reports after one is resolved. */
  reportsChanged: () => void;
  /** Put an item the server just sent back into the list. */
  itemChanged: (item: ItemSummary | undefined) => void;
  nfc: NfcAvailability | null;
  /** Inside the Android or iOS app (for "update the app" wording). */
  native: boolean;
  scan: ScanState;
  queue: QueuedScan[];
  failures: SettledFailure[];
  /** False with no signal, and for a short while after a request got no answer. */
  online: boolean;

  openScan: () => void;
  openItem: (view: ItemView) => void;
  openNew: (uid: string, offline?: boolean) => void;
  openAudit: () => void;
  openHandover: (request: LenderRequest, startNow?: boolean) => void;
  close: () => void;

  startScan: (continuous: boolean) => void;
  stopScan: () => void;
  /** The mounted scanning screen's handler for tags; returns a cleanup. */
  setTagHandler: (fn: ((uid: string) => void) | null) => void;

  lookupTag: (uid: string) => Promise<View | { kind: "error"; error: string }>;
  /** One item action through /api/equipment/items/[id]/actions, queued if offline. */
  act: (itemId: string, body: OpBody, label: string) => Promise<Outcome>;
  /** One scan by tag (or item) through the batch route, queued if offline. */
  scanOp: (body: OpBody, label: string) => Promise<Outcome>;
  commission: (
    body: { tagUid?: string; equipmentId: string; assetCode?: string; label?: string; location?: string },
    label: string,
  ) => Promise<Outcome>;
  /** Principals only: whether the item card offers "Delete item". */
  canDelete: boolean;
  /**
   * Delete a tagged item for good, freeing its tag (principals only; online
   * only, since it can't be undone). Resolves to an error message, or null.
   */
  removeItem: (itemId: string) => Promise<string | null>;
  flush: () => Promise<void>;
  dismissFailures: () => void;
}

const Ctx = createContext<KitContext | null>(null);

/** The lender's kit tools, or null for anyone else (render nothing). */
export function useKit(): KitContext | null {
  return useContext(Ctx);
}

const ITEMS_KEY = "hiking:kit:items";
const ITEMS_KEEP_MS = 14 * 24 * 60 * 60 * 1000;
const NETWORK_ERROR = "Couldn't reach the server. Try again.";
/** How long to wait for an answer before saving the scan for later. */
const LOOKUP_MS = 5000;
const ACTION_MS = 8000;
const BATCH_MS = 20000;
/** After a request gets no answer, scans skip the network for this long. */
const QUIET_MS = 30000;
/** How often to try sending waiting scans while the page is open. */
const RETRY_MS = 30000;
const PENDING_ERROR = "This item was tagged on this phone and hasn't been sent yet. Try again once it has.";
const SIGNAL_ERROR = "Handing kit to someone needs a signal. Try again once you're online.";

function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The offline lookup copy: no borrower names kept on the phone. */
function storeItems(items: ItemSummary[]) {
  try {
    const stripped = items.map((i) => (i.loan ? { ...i, loan: { ...i.loan, borrower: null } } : i));
    localStorage.setItem(ITEMS_KEY, JSON.stringify({ expiresAt: Date.now() + ITEMS_KEEP_MS, items: stripped }));
  } catch {
    // Full or private mode.
  }
}

function storedItems(): ItemSummary[] | null {
  try {
    const raw = localStorage.getItem(ITEMS_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { expiresAt: number; items: ItemSummary[] };
    if (stored.expiresAt < Date.now()) {
      localStorage.removeItem(ITEMS_KEY);
      return null;
    }
    return Array.isArray(stored.items) ? stored.items : null;
  } catch {
    return null;
  }
}

async function postJson(url: string, body: unknown, ms = ACTION_MS): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetchWithin(
    url,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    ms,
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

function fromResult(data: Record<string, unknown>): Outcome {
  const { ok: _ok, clientId: _id, ...rest } = data as unknown as BatchOpResult;
  void _ok;
  void _id;
  return { kind: "ok", result: rest };
}

export function KitLenderProvider({
  enabled,
  canDelete = false,
  equipment,
  requests,
  reports = NO_REPORTS,
  onReportsChanged = noop,
  onChanged,
  children,
}: {
  enabled: boolean;
  canDelete?: boolean;
  equipment: Equipment[];
  requests: LenderRequest[];
  reports?: ConditionReport[];
  onReportsChanged?: () => void;
  /** Reload the page's kit and requests (after a handover or check-in). */
  onChanged: () => void;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <KitLenderInner
      canDelete={canDelete}
      equipment={equipment}
      requests={requests}
      reports={reports}
      onReportsChanged={onReportsChanged}
      onChanged={onChanged}
    >
      {children}
    </KitLenderInner>
  );
}

const NO_REPORTS: ConditionReport[] = [];
function noop() {}

function KitLenderInner({
  canDelete,
  equipment,
  requests,
  reports,
  onReportsChanged,
  onChanged,
  children,
}: {
  canDelete: boolean;
  equipment: Equipment[];
  requests: LenderRequest[];
  reports: ConditionReport[];
  onReportsChanged: () => void;
  onChanged: () => void;
  children: ReactNode;
}) {
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [nfc, setNfc] = useState<NfcAvailability | null>(null);
  const [native] = useState(() => typeof window !== "undefined" && Capacitor.isNativePlatform());
  const [view, setView] = useState<View | null>(null);
  const [scan, setScan] = useState<ScanState>({ active: false, continuous: false, error: null });
  const [queue, setQueue] = useState<QueuedScan[]>([]);
  const [failures, setFailures] = useState<SettledFailure[]>([]);
  const [online, setOnline] = useState(true);

  const session = useRef<ScanSession | null>(null);
  const sessionId = useRef(0);
  const handler = useRef<((uid: string) => void) | null>(null);
  const buffered = useRef<string[]>([]);
  const flushing = useRef(false);
  /** Until when scans skip the network, after one got no answer (lie-fi). */
  const quietUntil = useRef(0);
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  // ---- signal ----------------------------------------------------------------

  /** No signal, or there was none a moment ago: go straight to the queue. */
  const offlineNow = useCallback(() => !navigator.onLine || Date.now() < quietUntil.current, []);
  const reached = useCallback(() => {
    quietUntil.current = 0;
    setOnline(true);
  }, []);
  const unreachable = useCallback(() => {
    quietUntil.current = Date.now() + QUIET_MS;
    setOnline(false);
  }, []);

  // ---- items ---------------------------------------------------------------

  const loadItems = useCallback(async () => {
    try {
      const res = await fetchWithin("/api/equipment/items", { cache: "no-store" }, BATCH_MS);
      reached();
      if (!res.ok) return;
      const data = (await res.json()) as { items?: ItemSummary[] };
      const list = data.items ?? [];
      setItems(list);
      storeItems(list);
    } catch (err) {
      // Offline: keep the stored copy.
      if (looksOffline(navigator.onLine, err)) unreachable();
    } finally {
      setItemsLoaded(true);
    }
  }, [reached, unreachable]);

  /** Put an item the server just sent back into the list. */
  const mergeItem = useCallback((item: ItemSummary | undefined) => {
    if (!item) return;
    setItems((list) => {
      const next = list.some((i) => i.id === item.id) ? list.map((i) => (i.id === item.id ? item : i)) : [...list, item];
      storeItems(next);
      return next;
    });
  }, []);

  const removeItem = useCallback(async (itemId: string): Promise<string | null> => {
    if (!navigator.onLine) return "You're offline. Deleting an item needs a signal.";
    try {
      const res = await fetch(`/api/equipment/items/${itemId}`, { method: "DELETE" });
      // 404: already gone, which is what was asked for.
      if (!res.ok && res.status !== 404) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return data.error || "Couldn't delete the item. Try again.";
      }
    } catch {
      return "Couldn't reach the server. Try again.";
    }
    setItems((list) => {
      const next = list.filter((i) => i.id !== itemId);
      storeItems(next);
      return next;
    });
    return null;
  }, []);

  // ---- offline queue --------------------------------------------------------

  const flush = useCallback(async () => {
    if (flushing.current || !navigator.onLine) return;
    const pending = readQueue(localStorage);
    if (!pending.length) return;
    flushing.current = true;
    let saved = 0;
    try {
      for (const batch of chunk(pending, MAX_BATCH_OPS)) {
        const { status, data } = await postJson("/api/equipment/items/batch", { ops: batch.map((q) => q.op) }, BATCH_MS);
        reached();
        if (status !== 200 || !Array.isArray(data.results)) {
          setFailures((f) => [
            ...f.filter((x) => x.clientId !== "batch"),
            { clientId: "batch", label: "Waiting scans", error: (data.error as string) || "The server didn't take the waiting scans. They'll be tried again." },
          ]);
          break;
        }
        const settled = settleQueue(batch, data.results as BatchOpResult[]);
        saved += settled.saved;
        const merged = mergeAfterFlush(readQueue(localStorage), batch, settled.keep);
        writeQueue(localStorage, merged);
        setQueue(merged);
        for (const r of data.results as BatchOpResult[]) if (r.ok) mergeItem(r.item);
        if (settled.failures.length) setFailures((f) => [...f.filter((x) => x.clientId !== "batch"), ...settled.failures]);
        else setFailures((f) => f.filter((x) => x.clientId !== "batch"));
      }
    } catch (err) {
      // Still no signal; the queue waits for the next try.
      if (looksOffline(navigator.onLine, err)) unreachable();
    } finally {
      flushing.current = false;
    }
    if (saved > 0) {
      void loadItems();
      onChangedRef.current();
    }
  }, [loadItems, mergeItem, reached, unreachable]);

  // While scans are waiting, keep trying: the "online" event alone misses a
  // phone that never lost its connection, only its signal.
  const waiting = queue.length > 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void flush();
    }, RETRY_MS);
    return () => clearInterval(timer);
  }, [waiting, flush]);

  // The kit as it will be once the waiting scans are sent.
  const projection = useMemo(() => projectQueue(items, queue, requests, equipment), [items, queue, requests, equipment]);
  const projectionRef = useRef(projection);
  useEffect(() => {
    projectionRef.current = projection;
  }, [projection]);

  /**
   * Save a scan for later, after judging it on the phone: a repeat scan isn't
   * queued again, the wrong kind of kit is refused there and then, and
   * anything the server looks likely to refuse comes back with a warning.
   */
  const queueOp = useCallback((op: BatchOp, label: string): Outcome => {
    const { items: now, queuedOut } = projectionRef.current;
    const preview = previewScan(now, op, requests, queuedOut);
    if (preview.verdict === "refuse") return { kind: "error", error: preview.error };
    if (preview.verdict === "noop") return { kind: "ok", result: { item: preview.item, noop: true, message: preview.message } };
    setQueue(enqueue(localStorage, { op, label }));
    if (preview.verdict === "doubt") return { kind: "queued", item: preview.item, warning: preview.error };
    return { kind: "queued", item: preview.verdict === "apply" ? preview.item : undefined };
  }, [requests]);

  // Mount: stored items and queue, then the network; NFC support; online events.
  useEffect(() => {
    const stored = storedItems();
    const t = setTimeout(() => {
      if (stored) setItems(stored);
      setQueue(readQueue(localStorage));
      setOnline(navigator.onLine);
      void loadItems();
      void flush();
    }, 0);
    let alive = true;
    const checkNfc = () => {
      void nfcAvailability().then((a) => {
        if (alive) setNfc(a);
      });
    };
    checkNfc();
    const up = () => {
      quietUntil.current = 0;
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    // Coming back from the phone's NFC settings.
    const visible = () => {
      if (document.visibilityState === "visible") {
        checkNfc();
        void flush();
        void loadItems();
      }
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      clearTimeout(t);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [flush, loadItems]);

  // ---- scanning ------------------------------------------------------------

  const stopScan = useCallback(() => {
    sessionId.current++;
    const s = session.current;
    session.current = null;
    buffered.current = [];
    setScan((prev) => ({ ...prev, active: false }));
    void s?.stop();
  }, []);

  const deliver = useCallback((uid: string) => {
    if (handler.current) handler.current(uid);
    else buffered.current.push(uid);
  }, []);

  /** Must run inside a tap: Web NFC asks for permission on the first scan. */
  const startScan = useCallback(
    (continuous: boolean) => {
      const previous = session.current;
      session.current = null;
      const id = ++sessionId.current;
      buffered.current = [];
      setScan({ active: true, continuous, error: null });
      let started = false;
      const begin = () =>
        startScanning({
          continuous,
          onTag: (uid) => {
            if (id === sessionId.current) deliver(uid);
          },
          onError: (message) => {
            if (id !== sessionId.current) return;
            // A failed start, an iOS session that died, or NFC switched off
            // ends the session; a bad read on Android or the web doesn't.
            const fatal = !started || Capacitor.getPlatform() === "ios" || /switched off|can't read NFC/i.test(message);
            setScan((prev) => ({ ...prev, error: message, active: fatal ? false : prev.active }));
            if (fatal) session.current = null;
          },
          onEnd: () => {
            if (id !== sessionId.current) return;
            session.current = null;
            setScan((prev) => ({ ...prev, active: false }));
          },
        }).then((s) => {
          started = true;
          if (id !== sessionId.current) void s.stop();
          else session.current = s;
        });
      if (previous) void previous.stop().then(begin);
      else void begin();
    },
    [deliver],
  );

  const setTagHandler = useCallback((fn: ((uid: string) => void) | null) => {
    handler.current = fn;
    if (fn && buffered.current.length) {
      const waiting = buffered.current.splice(0);
      for (const uid of waiting) fn(uid);
    }
  }, []);

  // Stop listening when the sheet closes or the page goes.
  useEffect(() => () => {
    sessionId.current++;
    void session.current?.stop();
  }, []);

  // ---- views ---------------------------------------------------------------

  const close = useCallback(() => {
    stopScan();
    setView(null);
  }, [stopScan]);

  const canScan = nfc?.support !== "none";

  const openScan = useCallback(() => {
    setView({ kind: "scan" });
    if (canScan) startScan(false);
  }, [canScan, startScan]);

  const openItem = useCallback(
    (v: ItemView) => {
      stopScan();
      setView({ kind: "item", ...v });
    },
    [stopScan],
  );

  const openNew = useCallback((uid: string, offline?: boolean) => setView({ kind: "new", uid, offline }), []);

  // A kit link (/kit/<id>, from a tag read outside the app) lands here as
  // ?item=<id>: open that item once the list is in, then drop the parameter.
  const linkedItem = useSearchParams().get("item");
  const followedLink = useRef<string | null>(null);
  useEffect(() => {
    if (!linkedItem) followedLink.current = null;
    if (!linkedItem || !itemsLoaded || followedLink.current === linkedItem) return;
    followedLink.current = linkedItem;
    const url = new URL(window.location.href);
    url.searchParams.delete("item");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    const item = items.find((i) => i.id === linkedItem);
    if (item) queueMicrotask(() => openItem({ item }));
  }, [linkedItem, itemsLoaded, items, openItem]);

  const openAudit = useCallback(() => {
    stopScan();
    setView({ kind: "audit" });
  }, [stopScan]);

  const openHandover = useCallback(
    (request: LenderRequest, startNow = true) => {
      setView({ kind: "handover", requestId: request.id });
      if (startNow && canScan) startScan(true);
      else stopScan();
    },
    [canScan, startScan, stopScan],
  );

  // ---- server calls --------------------------------------------------------

  const lookupTag = useCallback(
    async (uid: string): Promise<View | { kind: "error"; error: string }> => {
      const offlineAnswer = (): View => {
        const item = projectionRef.current.items.find((i) => i.tag_uid === uid);
        return item ? { kind: "item", item, offline: true } : { kind: "new", uid, offline: true };
      };
      if (offlineNow()) return offlineAnswer();
      // Tagged on this phone and not sent yet: the server can't know it.
      const pending = projectionRef.current.items.find((i) => i.tag_uid === uid && isPendingItem(i));
      if (pending) return { kind: "item", item: pending, offline: true };
      try {
        const res = await fetchWithin(
          `/api/equipment/items/by-tag/${encodeURIComponent(uid)}`,
          { cache: "no-store" },
          LOOKUP_MS,
        );
        reached();
        const data = (await res.json().catch(() => ({}))) as Partial<TagLookup> & { unregistered?: boolean; error?: string };
        if (res.ok && data.item) {
          mergeItem(data.item);
          return { kind: "item", item: data.item, loan: data.loan ?? null };
        }
        if (res.status === 404 && data.unregistered) return { kind: "new", uid };
        return { kind: "error", error: data.error || "Couldn't look up that tag." };
      } catch (err) {
        if (looksOffline(navigator.onLine, err)) {
          unreachable();
          return offlineAnswer();
        }
        return { kind: "error", error: NETWORK_ERROR };
      }
    },
    [mergeItem, offlineNow, reached, unreachable],
  );

  const afterOk = useCallback(
    (outcome: Outcome, action: string) => {
      if (outcome.kind !== "ok") return;
      mergeItem(outcome.result.item);
      if (action === "check_out" || action === "check_in" || action === "hand_out" || action === "transfer") onChangedRef.current();
    },
    [mergeItem],
  );

  const act = useCallback(
    async (itemId: string, body: OpBody, label: string): Promise<Outcome> => {
      const op = { ...body, itemId, clientId: newClientId(), at: new Date().toISOString() } as BatchOp;
      if (itemId.startsWith("queued:")) return { kind: "error", error: PENDING_ERROR };
      // Putting kit in someone's hands tells them, so it's never queued for later.
      const needsSignal = body.action === "hand_out" || body.action === "transfer";
      if (offlineNow()) return needsSignal ? { kind: "error", error: SIGNAL_ERROR } : queueOp(op, label);
      try {
        const { status, data } = await postJson(`/api/equipment/items/${encodeURIComponent(itemId)}/actions`, op);
        reached();
        if (status >= 200 && status < 300) {
          const outcome = fromResult(data);
          afterOk(outcome, body.action);
          return outcome;
        }
        return { kind: "error", error: (data.error as string) || "Couldn't save that." };
      } catch (err) {
        if (looksOffline(navigator.onLine, err)) {
          unreachable();
          return needsSignal ? { kind: "error", error: SIGNAL_ERROR } : queueOp(op, label);
        }
        return { kind: "error", error: NETWORK_ERROR };
      }
    },
    [afterOk, queueOp, offlineNow, reached, unreachable],
  );

  const scanOp = useCallback(
    async (body: OpBody, label: string): Promise<Outcome> => {
      const op = { ...body, clientId: newClientId(), at: new Date().toISOString() } as BatchOp;
      // A tag tagged on this phone is only known here; keep its scans in order behind it.
      const uid = "uid" in op ? op.uid : undefined;
      const pending = uid && projectionRef.current.items.some((i) => i.tag_uid === uid && isPendingItem(i));
      if (offlineNow() || pending) return queueOp(op, label);
      try {
        const { status, data } = await postJson("/api/equipment/items/batch", { ops: [op] });
        reached();
        const result = Array.isArray(data.results) ? (data.results[0] as BatchOpResult | undefined) : undefined;
        if (status !== 200 || !result) return { kind: "error", error: (data.error as string) || "Couldn't save that scan." };
        if (!result.ok) {
          return { kind: "error", error: result.error || "Couldn't save that scan.", unregistered: result.unregistered, uid: result.uid };
        }
        const outcome = fromResult(result as unknown as Record<string, unknown>);
        afterOk(outcome, body.action);
        return outcome;
      } catch (err) {
        if (looksOffline(navigator.onLine, err)) {
          unreachable();
          return queueOp(op, label);
        }
        return { kind: "error", error: NETWORK_ERROR };
      }
    },
    [afterOk, queueOp, offlineNow, reached, unreachable],
  );

  const commission = useCallback<KitContext["commission"]>(
    async (body, label) => {
      const clientId = newClientId();
      const at = new Date().toISOString();
      const queueIt = (): Outcome => queueOp({ action: "tagged", clientId, at, ...body, uid: body.tagUid }, label);
      if (offlineNow()) return queueIt();
      try {
        const { status, data } = await postJson("/api/equipment/items", { ...body, clientId, at });
        reached();
        if (status >= 200 && status < 300) {
          const outcome = fromResult(data);
          afterOk(outcome, "tagged");
          return outcome;
        }
        return { kind: "error", error: (data.error as string) || "Couldn't tag that item." };
      } catch (err) {
        if (looksOffline(navigator.onLine, err)) {
          unreachable();
          return queueIt();
        }
        return { kind: "error", error: NETWORK_ERROR };
      }
    },
    [afterOk, queueOp, offlineNow, reached, unreachable],
  );

  const dismissFailures = useCallback(() => setFailures([]), []);

  const value = useMemo<KitContext>(
    () => ({
      items: projection.items,
      queuedOut: projection.queuedOut,
      itemsLoaded,
      equipment,
      requests,
      reports,
      reportsChanged: onReportsChanged,
      itemChanged: mergeItem,
      nfc,
      native,
      scan,
      queue,
      failures,
      online,
      openScan,
      openItem,
      openNew,
      openAudit,
      openHandover,
      close,
      startScan,
      stopScan,
      setTagHandler,
      lookupTag,
      act,
      scanOp,
      commission,
      canDelete,
      removeItem,
      flush,
      dismissFailures,
    }),
    [
      projection,
      itemsLoaded,
      equipment,
      requests,
      reports,
      onReportsChanged,
      mergeItem,
      nfc,
      native,
      scan,
      queue,
      failures,
      online,
      openScan,
      openItem,
      openNew,
      openAudit,
      openHandover,
      close,
      startScan,
      stopScan,
      setTagHandler,
      lookupTag,
      act,
      scanOp,
      commission,
      canDelete,
      removeItem,
      flush,
      dismissFailures,
    ],
  );

  const handoverRequest = view?.kind === "handover" ? requests.find((r) => r.id === view.requestId) : undefined;

  return (
    <Ctx.Provider value={value}>
      {children}
      {view && (
        <Sheet onClose={close} labelledBy="kit-sheet-title">
          {view.kind === "audit" ? (
            <AuditMode />
          ) : view.kind === "handover" ? (
            handoverRequest ? (
              <HandoverSheet request={handoverRequest} />
            ) : (
              <>
                <h3 id="kit-sheet-title">Request not found</h3>
                <p>It may have been checked in or changed. Close this and try again.</p>
              </>
            )
          ) : (
            <ScanSheet
              key={view.kind === "item" ? `item-${view.item.id}` : view.kind === "new" ? `new-${view.uid}` : "scan"}
              view={view}
              onView={setView}
            />
          )}
        </Sheet>
      )}
    </Ctx.Provider>
  );
}

export type ScanView = Extract<View, { kind: "scan" | "item" | "new" }>;
