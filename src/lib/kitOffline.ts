import type { Equipment, EquipmentRequest } from "@/lib/types";

/**
 * What a kit lender's phone keeps so the Equipment page can hand kit over
 * with no signal after a cold start: the kit types and the booked and out loans.
 * The page's own cache (client-cache.ts) is memory only and gone after a
 * reload, which is exactly when the kit room has no signal.
 *
 * Kept small on purpose: booked and out loans only, each borrower's name and
 * nothing else about them (no email, no member record), for two weeks after
 * the page last loaded with signal. The tagged items are kept separately by
 * KitLender, with no borrower names at all.
 */

export const LENDER_KEY = "hiking:kit:lender";
export const LENDER_KEEP_MS = 14 * 24 * 60 * 60 * 1000;

export interface LenderSnapshot {
  equipment: Equipment[];
  requests: EquipmentRequest[];
  savedAt: string;
}

/** An approved loan, cut down to what an offline handover shows. */
function slim(request: EquipmentRequest): EquipmentRequest {
  const name = request.member?.full_name || request.borrower_name || null;
  return {
    ...request,
    member_id: null,
    purpose: "",
    notes: null,
    member: null,
    borrower_name: name,
    borrower_email: null,
    equipment: request.equipment ? { ...request.equipment } : undefined,
  };
}

export function storeLenderSnapshot(
  storage: Storage,
  equipment: Equipment[],
  requests: EquipmentRequest[],
  now = Date.now(),
): void {
  const value: LenderSnapshot = {
    equipment,
    // Booked pickups too: the handover at the meet is often where there is no signal.
    requests: requests.filter((r) => r.status === "approved" || r.status === "booked").map(slim),
    savedAt: new Date(now).toISOString(),
  };
  try {
    storage.setItem(LENDER_KEY, JSON.stringify({ expiresAt: now + LENDER_KEEP_MS, value }));
  } catch {
    // Full or private mode: the page still works with signal.
  }
}

export function readLenderSnapshot(storage: Storage, now = Date.now()): LenderSnapshot | null {
  try {
    const raw = storage.getItem(LENDER_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { expiresAt?: number; value?: LenderSnapshot };
    if (!stored.value || !(Number(stored.expiresAt) > now)) {
      storage.removeItem(LENDER_KEY);
      return null;
    }
    const { equipment, requests } = stored.value;
    return Array.isArray(equipment) && Array.isArray(requests) ? stored.value : null;
  } catch {
    return null;
  }
}
