import {
  planAction,
  type ActionInput,
  type BatchOpResult,
  type ItemPatch,
  type ItemStatus,
  type ItemSummary,
} from "@/lib/equipmentItems";
import { isTimeout } from "@/lib/fetchWithin";

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
  | { action: "hand_out"; toMemberId: string; endDate?: string; purpose?: string }
  | { action: "transfer"; toMemberId: string; notes?: string }
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

/** A booked or out request, with the tagged items already out against it. */
export interface LoanForHandover {
  id: string;
  status: string;
  equipment_id: string;
  quantity: number;
  items?: { id: string }[];
}

/** Booked and out requests for a kit type that still have room for another tagged item. */
export function requestsWithRoom<T extends LoanForHandover>(
  requests: T[],
  equipmentId: string,
  queuedOut: Map<string, number> = new Map(),
): T[] {
  return requests.filter(
    (r) =>
      (r.status === "approved" || r.status === "booked") &&
      r.equipment_id === equipmentId &&
      (r.items?.length ?? 0) + (queuedOut.get(r.id) ?? 0) < r.quantity,
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

/**
 * True when a fetch failure means "no connection" rather than "the server said
 * no": the phone says it's offline, the request never got out, or it got no
 * answer in time (fetchWithin).
 */
export function looksOffline(online: boolean, error?: unknown): boolean {
  if (!online) return true;
  return error instanceof TypeError || isTimeout(error);
}

// ---------------------------------------------------------------------------
// The queue, played over the phone's copy of the kit
// ---------------------------------------------------------------------------

/** A request as the projection needs it (EquipmentRequest fits). */
export interface ProjectionRequest {
  id: string;
  status: string;
  equipment_id: string;
  quantity: number;
  start_date: string;
  end_date: string;
  equipment?: { name: string } | null;
  items?: { id: string }[];
}

/** A kit type as the projection needs it (Equipment fits). */
export interface ProjectionKind {
  id: string;
  name: string;
  category?: string | null;
}

/** Items tagged on this phone that the server hasn't seen yet carry this id prefix. */
export const PENDING_ITEM = "queued:";

export function isPendingItem(item: Pick<ItemSummary, "id">): boolean {
  return item.id.startsWith(PENDING_ITEM);
}

export interface Projection {
  /** The kit as it will be once the waiting scans are sent. */
  items: ItemSummary[];
  /** Check-outs waiting to send, per request id. */
  queuedOut: Map<string, number>;
}

/** What a scan would come to, judged on the phone with no signal. */
export type Preview =
  /** Not on the phone's list (an untagged uid, say): the server will decide. */
  | { verdict: "unknown" }
  | { verdict: "apply"; item: ItemSummary }
  /** Already done (a repeat scan): nothing to queue. */
  | { verdict: "noop"; item: ItemSummary; message: string }
  /** Certain to be refused, whatever has changed since: don't queue it. */
  | { verdict: "refuse"; error: string }
  /** Would be refused on what the phone last saw, which may be out of date. */
  | { verdict: "doubt"; item: ItemSummary; error: string };

function locate(items: ItemSummary[], op: Pick<BatchOp, "itemId" | "uid">): number {
  if (op.itemId) return items.findIndex((i) => i.id === op.itemId);
  if (op.uid) return items.findIndex((i) => i.tag_uid === op.uid);
  return -1;
}

function patched(item: ItemSummary, patch: ItemPatch, at: string, request?: ProjectionRequest): ItemSummary {
  const next: ItemSummary = { ...item, updated_at: at };
  if (patch.status) next.status = patch.status;
  if (patch.condition) next.condition = patch.condition;
  if (patch.location !== undefined) next.location = patch.location;
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.last_audited_at) next.last_audited_at = patch.last_audited_at;
  if (patch.loan_request_id === null) next.loan = null;
  else if (patch.loan_request_id) {
    next.loan = {
      request_id: patch.loan_request_id,
      borrower: null,
      start_date: request?.start_date ?? "",
      end_date: request?.end_date ?? "",
    };
  }
  return next;
}

/** The item a queued "tagged" op will create, as the lists show it until it's sent. */
function pendingItem(op: Extract<BatchOp, { action: "tagged" }>, kinds: ProjectionKind[]): ItemSummary {
  const kind = kinds.find((k) => k.id === op.equipmentId);
  return {
    id: `${PENDING_ITEM}${op.clientId}`,
    equipment_id: op.equipmentId,
    equipment_name: kind?.name ?? "Kit",
    category: kind?.category ?? "",
    tag_uid: op.tagUid ?? op.uid ?? null,
    asset_code: op.assetCode?.trim() || "New item",
    label: op.label?.trim() || null,
    location: op.location?.trim() || null,
    status: "available",
    condition: "good",
    last_audited_at: op.at,
    notes: op.notes?.trim() || null,
    updated_at: op.at,
    loan: null,
  };
}

/**
 * Judge one scan against the kit as it stands, using the server's own rules
 * (planAction). Only a check-out of the wrong kind of kit is refused outright,
 * since an item's kind doesn't change; anything that turns on status could be
 * out of date, so it's queued with a warning instead.
 */
export function previewScan(
  items: ItemSummary[],
  op: BatchOp,
  requests: ProjectionRequest[],
  queuedOut: Map<string, number> = new Map(),
): Preview {
  if (op.action === "tagged") return { verdict: "unknown" };
  const index = locate(items, op);
  if (index < 0) return { verdict: "unknown" };
  const item = items[index];

  let request: ProjectionRequest | undefined;
  if (op.action === "check_out") {
    request = requests.find((r) => r.id === op.requestId);
    if (request && request.equipment_id !== item.equipment_id) {
      const wanted = request.equipment?.name ?? "something else";
      return { verdict: "refuse", error: `${item.asset_code} is a ${item.equipment_name}, but this request is for ${wanted}.` };
    }
  }

  const plan = planAction(
    { ...item, loan_request_id: item.loan?.request_id ?? null },
    op as ActionInput,
    op.at,
    request
      ? {
          id: request.id,
          status: request.status,
          equipment_id: request.equipment_id,
          equipment_name: request.equipment?.name ?? "",
          quantity: request.quantity,
          borrower: null,
          itemsOut: (request.items?.length ?? 0) + (queuedOut.get(request.id) ?? 0),
        }
      : null,
  );
  if (!plan.ok) {
    // A request missing from the phone's copy may just be newer than it.
    return { verdict: "doubt", item, error: plan.error };
  }
  if (plan.noop) return { verdict: "noop", item, message: plan.message };
  return { verdict: "apply", item: patched(item, plan.patch, op.at, request) };
}

/**
 * Play the waiting scans over the phone's copy of the kit, in order, so the
 * lists, the item card and the next offline scan all see them: a handed-over
 * tent shows "On loan", and a tag tagged offline is that item, not a new tag.
 * Scans that will be refused leave the item as it was.
 */
export function projectQueue(
  items: ItemSummary[],
  queue: QueuedScan[],
  requests: ProjectionRequest[],
  kinds: ProjectionKind[],
): Projection {
  const queuedOut = new Map<string, number>();
  if (!queue.length) return { items, queuedOut };
  const list = items.slice();
  for (const { op } of queue) {
    if (op.action === "tagged") {
      const tag = op.tagUid ?? op.uid;
      if (tag && list.some((i) => i.tag_uid === tag)) continue;
      list.push(pendingItem(op, kinds));
      continue;
    }
    const preview = previewScan(list, op, requests, queuedOut);
    if (preview.verdict !== "apply") continue;
    list[locate(list, op)] = preview.item;
    if (op.action === "check_out") queuedOut.set(op.requestId, (queuedOut.get(op.requestId) ?? 0) + 1);
  }
  return { items: list, queuedOut };
}
