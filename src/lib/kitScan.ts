import type { BatchOpResult, ItemStatus, ItemSummary } from "@/lib/equipmentItems";

/**
 * The pure half of the lender's scanning screens: the offline queue of scans,
 * handover progress, and what a shelf audit didn't see. No React, no fetch, so
 * it can be tested; the components in src/components/kit do the talking.
 */

// ---------------------------------------------------------------------------
// Offline queue
// ---------------------------------------------------------------------------

/** One scan as POST /api/equipment/items/batch takes it. */
export type BatchOp = {
  clientId: string;
  at: string;
  /** The item, when we know it; otherwise the server finds it by `uid`. */
  itemId?: string;
  uid?: string;
} & (
  | { action: "check_out"; requestId: string }
  | { action: "check_in"; condition?: string; notes?: string }
  | { action: "audit"; location?: string }
  | { action: "flag"; condition: string; notes?: string }
  | { action: "tagged"; equipmentId: string; tagUid?: string; assetCode?: string; label?: string; location?: string; notes?: string }
);

/** A queued scan and the words to show for it while it waits. */
export interface QueuedScan {
  op: BatchOp;
  label: string;
}

export const QUEUE_KEY = "hiking:kit:outbox";

export function readQueue(storage: Storage): QueuedScan[] {
  try {
    const raw = storage.getItem(QUEUE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((e): e is QueuedScan => Boolean(e?.op?.clientId)) : [];
  } catch {
    return [];
  }
}

export function writeQueue(storage: Storage, queue: QueuedScan[]): void {
  try {
    if (queue.length) storage.setItem(QUEUE_KEY, JSON.stringify(queue));
    else storage.removeItem(QUEUE_KEY);
  } catch {
    // Full or private mode: nothing more we can do.
  }
}

/** Add a scan, ignoring one already queued under the same clientId. */
export function enqueue(storage: Storage, entry: QueuedScan): QueuedScan[] {
  const queue = readQueue(storage);
  if (!queue.some((q) => q.op.clientId === entry.op.clientId)) queue.push(entry);
  writeQueue(storage, queue);
  return queue;
}

/** The batch route's own words for a scan it couldn't save this time. */
const RETRY_HINT = "will be retried";

export interface SettledFailure {
  clientId: string;
  label: string;
  error: string;
}

/**
 * Fold the batch's per-op results back into the queue. Saved scans (and
 * duplicates and no-ops) leave it; a scan the server refused for a reason
 * (wrong kit, request full) leaves it too and is reported; one that failed
 * for a passing reason, or got no result at all, stays to be sent again.
 */
export function settleQueue(
  sent: QueuedScan[],
  results: BatchOpResult[],
): { keep: QueuedScan[]; failures: SettledFailure[]; saved: number } {
  const byId = new Map(results.filter((r) => r.clientId).map((r) => [r.clientId as string, r]));
  const keep: QueuedScan[] = [];
  const failures: SettledFailure[] = [];
  let saved = 0;
  for (const entry of sent) {
    const result = byId.get(entry.op.clientId);
    if (!result) keep.push(entry);
    else if (result.ok) saved++;
    else if (result.error?.includes(RETRY_HINT)) keep.push(entry);
    else failures.push({ clientId: entry.op.clientId, label: entry.label, error: result.error || "The server refused this scan." });
  }
  return { keep, failures, saved };
}

/**
 * What is in storage now, minus what was just sent, plus what the server asked
 * to have sent again: scans queued while the batch was in flight are kept.
 */
export function mergeAfterFlush(current: QueuedScan[], sent: QueuedScan[], keep: QueuedScan[]): QueuedScan[] {
  const sentIds = new Set(sent.map((s) => s.op.clientId));
  return [...keep, ...current.filter((q) => !sentIds.has(q.op.clientId))];
}

/** Cut a queue into batches the server will take. */
export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

// ---------------------------------------------------------------------------
// Handover
// ---------------------------------------------------------------------------

export interface HandoverProgress {
  /** Handed over, counting scans still waiting to send. */
  done: number;
  total: number;
  remaining: number;
  complete: boolean;
  label: string;
}

/** "2 of 3 handed over" for a request of `quantity`, `itemsOut` saved and `queued` waiting. */
export function handoverProgress(quantity: number, itemsOut: number, queued = 0): HandoverProgress {
  const total = Math.max(0, quantity);
  const done = Math.min(total, Math.max(0, itemsOut) + Math.max(0, queued));
  const remaining = total - done;
  const label = `${done} of ${total} handed over${queued > 0 ? ` (${queued} waiting to send)` : ""}`;
  return { done, total, remaining, complete: total > 0 && remaining === 0, label };
}

/** An approved request, with the tagged items already out against it. */
export interface LoanForHandover {
  id: string;
  status: string;
  equipment_id: string;
  quantity: number;
  items?: { id: string }[];
}

/** Approved requests for a kit type that still have room for another tagged item. */
export function requestsWithRoom<T extends LoanForHandover>(requests: T[], equipmentId: string): T[] {
  return requests.filter(
    (r) => r.status === "approved" && r.equipment_id === equipmentId && (r.items?.length ?? 0) < r.quantity,
  );
}

// ---------------------------------------------------------------------------
// Shelf audit
// ---------------------------------------------------------------------------

/** Statuses an item can be in while it is meant to be on the shelf. */
const ON_SHELF: ItemStatus[] = ["available", "maintenance", "missing"];

/**
 * Tagged items an audit didn't see. Items out on loan aren't expected on the
 * shelf, so they're counted apart rather than reported as not seen.
 */
export function auditSummary(
  items: Pick<ItemSummary, "id" | "tag_uid" | "status" | "asset_code">[],
  seenItemIds: Iterable<string>,
  seenUids: Iterable<string> = [],
) {
  const seenIds = new Set(seenItemIds);
  const uids = new Set(seenUids);
  const tagged = items.filter((i) => i.tag_uid);
  const seen = (i: (typeof tagged)[number]) => seenIds.has(i.id) || uids.has(i.tag_uid!);
  const notSeen = tagged
    .filter((i) => ON_SHELF.includes(i.status) && !seen(i))
    .sort((a, b) => a.asset_code.localeCompare(b.asset_code));
  const onLoan = tagged.filter((i) => i.status === "on_loan" && !seen(i)).length;
  return { notSeen, onLoan, expected: tagged.length - onLoan };
}

// ---------------------------------------------------------------------------
// Items list
// ---------------------------------------------------------------------------

export const STATUS_LABELS: Record<ItemStatus, string> = {
  available: "In",
  on_loan: "On loan",
  maintenance: "Repair",
  missing: "Missing",
};

/** Match an item by asset code, label or kit type, for the search fallback. */
export function matchItems<T extends Pick<ItemSummary, "asset_code" | "label" | "equipment_name">>(
  items: T[],
  query: string,
  limit = 8,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const compact = q.replace(/[\s-]+/g, "");
  const scored = items
    .map((item) => {
      const code = item.asset_code.toLowerCase();
      const score =
        code === q || code.replace(/-/g, "") === compact
          ? 0
          : code.startsWith(q) || code.replace(/-/g, "").startsWith(compact)
            ? 1
            : code.includes(q) || item.label?.toLowerCase().includes(q)
              ? 2
              : item.equipment_name.toLowerCase().includes(q)
                ? 3
                : -1;
      return { item, score };
    })
    .filter((s) => s.score >= 0)
    .sort((a, b) => a.score - b.score || a.item.asset_code.localeCompare(b.item.asset_code));
  return scored.slice(0, limit).map((s) => s.item);
}

/** True when a fetch failure means "no connection" rather than "the server said no". */
export function looksOffline(online: boolean, error?: unknown): boolean {
  if (!online) return true;
  return error instanceof TypeError;
}
