import { GOVERNANCE_ROLES, isGovernanceRole, type GovernanceRole } from "@/lib/access";
import type { EquipmentRequestStatus } from "@/lib/types";

/**
 * Who may do what with a loan and with the kit on it. Pure, so it can be
 * tested; the routes read the rows and ask here, and the database holds the
 * same rules (migration 20261120000000_kit_custody_and_restrictions).
 *
 * The loan:
 *
 *   pending ──book──▶ booked ──handed over──▶ approved ("On loan") ──▶ returned
 *
 * - A member asks for kit (pending).
 * - A committee member books a pickup to meet them (booked): when, where, and
 *   who they're meeting. Stock is held from here.
 * - At the meet the committee member scans each item to hand it over. The
 *   first one moves the loan to approved; untagged kit is marked handed over.
 * - Back to storage by a committee member scanning it in, then the loan is
 *   marked returned.
 *
 * Custody, for each tagged item: who has it now. It changes hands three ways,
 * each one an event with who it came from and who it went to:
 * - check_out: storage → member, by a committee member (against a booked loan,
 *   or straight off the shelf with no request: "hand out").
 * - handover: member → member (A passes the tent to B on a trip). The
 *   receiver confirms it by scanning the item themselves ("I've got this"),
 *   since holding the tag is the proof; or a committee member records it. The
 *   giver can't push it on to someone on their own say-so, so nobody can
 *   offload responsibility without the other person knowing.
 * - check_in: member → storage, by a committee member.
 *
 * "Committee member" throughout means anyone who may handle kit: committee,
 * principals and admins by role, and anyone a principal granted it to
 * (kit_handlers).
 *
 * Restricted kit: a kind of kit can be limited to some governance roles
 * (drones: principals and admins). Only someone with one of those roles may
 * ask for it, be booked for it, or end up holding it, by any of the routes
 * above. Putting it back in storage is always allowed.
 */

// ---------------------------------------------------------------------------
// Restricted kit
// ---------------------------------------------------------------------------

/** The choices the inventory form offers. */
export const RESTRICTION_PRESETS = {
  anyone: null,
  committee: ["committee", "principal", "admin"],
  principals: ["principal", "admin"],
} as const satisfies Record<string, readonly GovernanceRole[] | null>;

export type RestrictionPreset = keyof typeof RESTRICTION_PRESETS;

export const RESTRICTION_PRESET_LABELS: Record<RestrictionPreset, string> = {
  anyone: "Anyone who can borrow",
  committee: "Committee and up",
  principals: "Principals only",
};

/**
 * A restriction as stored: the roles in their canonical order, no repeats, or
 * null for none. Unknown roles are dropped; nothing left means no restriction.
 */
export function normalizeRestriction(raw: unknown): GovernanceRole[] | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    if (raw in RESTRICTION_PRESETS) {
      const preset = RESTRICTION_PRESETS[raw as RestrictionPreset];
      return preset ? [...preset] : null;
    }
    return normalizeRestriction(raw.split(/[\s,;|]+/));
  }
  if (!Array.isArray(raw)) return null;
  const wanted = new Set(raw.map((r) => (typeof r === "string" ? r.trim().toLowerCase() : r)).filter(isGovernanceRole));
  const roles = GOVERNANCE_ROLES.filter((r) => wanted.has(r));
  return roles.length ? roles : null;
}

/** May someone with this role hold (ask for, be handed, be passed) this kit? */
export function mayHold(restrictedTo: readonly GovernanceRole[] | null | undefined, role: GovernanceRole | null | undefined): boolean {
  if (!restrictedTo || restrictedTo.length === 0) return true;
  return role != null && restrictedTo.includes(role);
}

/** Which preset a stored restriction is, or "custom". */
export function restrictionPreset(restrictedTo: readonly GovernanceRole[] | null | undefined): RestrictionPreset | "custom" {
  const roles = normalizeRestriction(restrictedTo ?? null);
  if (!roles) return "anyone";
  for (const [name, preset] of Object.entries(RESTRICTION_PRESETS)) {
    if (preset && preset.length === roles.length && preset.every((r) => roles.includes(r))) return name as RestrictionPreset;
  }
  return "custom";
}

const ROLE_PLURALS: Record<GovernanceRole, string> = { committee: "committee", principal: "principals", admin: "admins" };

/** "Principals and admins only", or null when anyone can borrow it. */
export function restrictionLabel(restrictedTo: readonly GovernanceRole[] | null | undefined): string | null {
  const roles = normalizeRestriction(restrictedTo ?? null);
  if (!roles) return null;
  if (restrictionPreset(roles) === "committee") return "Committee only";
  const names = roles.map((r) => ROLE_PLURALS[r]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} only`;
}

/** Why someone can't have restricted kit, in the words the app shows. */
export function restrictionError(
  kitName: string,
  restrictedTo: readonly GovernanceRole[] | null | undefined,
  who: string | null = null,
): string {
  const label = (restrictionLabel(restrictedTo) ?? "Restricted").toLowerCase();
  return who
    ? `${kitName} is ${label}, and ${who} can't take it out.`
    : `${kitName} is ${label}. Ask a principal if you need it.`;
}

// ---------------------------------------------------------------------------
// The loan
// ---------------------------------------------------------------------------

/** Statuses during which the loan holds stock (and so an item can go out on it). */
export const HOLDING_STATUSES = ["booked", "approved"] as const satisfies readonly EquipmentRequestStatus[];

export function holdsStock(status: string): boolean {
  return (HOLDING_STATUSES as readonly string[]).includes(status);
}

export type RequestTransition = "booked" | "approved" | "rejected" | "returned" | "cancelled";

export interface TransitionActor {
  /** The member who asked for the kit. */
  isOwner: boolean;
  /** Committee, principals, admins, and members granted kit handling. */
  isHandler: boolean;
  /** Principals and admins. */
  isPrincipal: boolean;
}

/**
 * Which status changes are allowed, and by whom. Closed requests stay closed.
 *
 * - book (pending → booked, or booked → booked to move the pickup), hand over
 *   (→ approved), decline (→ rejected) and take back (approved → returned):
 *   anyone who handles kit.
 * - withdraw (pending/booked → cancelled): the member, or a kit handler. The
 *   member can't cancel kit that is already out, or a borrower could "cancel"
 *   their own loan, restoring stock and clearing the way to delete their
 *   account while still holding the kit.
 * - write off an out loan without the kit coming back (approved → cancelled):
 *   principals only.
 */
export function canTransitionRequest(from: EquipmentRequestStatus, to: RequestTransition, who: TransitionActor): boolean {
  const handler = who.isHandler || who.isPrincipal;
  switch (from) {
    case "pending":
      if (to === "cancelled") return who.isOwner || handler;
      return (to === "booked" || to === "approved" || to === "rejected") && handler;
    case "booked":
      if (to === "cancelled") return who.isOwner || handler;
      return (to === "booked" || to === "approved" || to === "rejected") && handler;
    case "approved":
      if (to === "returned") return handler;
      if (to === "cancelled") return who.isPrincipal;
      return false;
    default:
      return false;
  }
}

export interface BookingInput {
  pickupAt: string;
  pickupLocation: string | null;
  pickupWithId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * Read a booking from a request body: a pickup time (required, an ISO time or
 * a datetime-local value read as London time), a place and who they're
 * meeting (both optional).
 */
export function parseBookingInput(raw: unknown, now: Date = new Date()): { ok: true; input: BookingInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Say when and where to meet." };
  const body = raw as Record<string, unknown>;
  const at = typeof body.pickupAt === "string" ? parsePickupTime(body.pickupAt) : null;
  if (!at) return { ok: false, error: "Choose when to meet to hand the kit over." };
  // A pickup set by mistake a year out, or long gone, is a typo.
  const day = 24 * 60 * 60 * 1000;
  if (Date.parse(at) < now.getTime() - day) return { ok: false, error: "That pickup time has already passed." };
  if (Date.parse(at) > now.getTime() + 366 * day) return { ok: false, error: "That pickup is more than a year away." };
  const location = typeof body.pickupLocation === "string" ? body.pickupLocation.trim().slice(0, 200) : "";
  let pickupWithId: string | null = null;
  if (body.pickupWithId !== undefined && body.pickupWithId !== null && body.pickupWithId !== "") {
    if (!isUuid(body.pickupWithId)) return { ok: false, error: "Choose who they're meeting." };
    pickupWithId = body.pickupWithId;
  }
  return { ok: true, input: { pickupAt: at, pickupLocation: location || null, pickupWithId } };
}

/**
 * "2026-11-21T18:30" (a datetime-local input, wall-clock London time) or a full
 * ISO time, as an ISO string. Null if it can't be read.
 */
export function parsePickupTime(value: string): string | null {
  const text = value.trim();
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (local) {
    const [, y, mo, d, h, mi, s] = local.map(Number);
    const guess = Date.UTC(y, mo - 1, d, h, mi, s || 0);
    if (Number.isNaN(guess)) return null;
    // London's offset at that moment (0 or +1), found by formatting the guess.
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const lh = Number(parts.find((p) => p.type === "hour")?.value);
    const lm = Number(parts.find((p) => p.type === "minute")?.value);
    const offsetMin = ((lh * 60 + lm - (h * 60 + mi)) % 1440 + 1440 + 720) % 1440 - 720;
    return new Date(guess - offsetMin * 60 * 1000).toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return null;
  const t = Date.parse(text);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// ---------------------------------------------------------------------------
// Custody
// ---------------------------------------------------------------------------

export interface CustodyActor {
  id: string;
  /** May handle kit (committee and up, or granted). */
  handlesKit: boolean;
}

/**
 * May this actor record an item passing from whoever has it to `toMemberId`?
 * A kit handler may record any handover; anyone else only one to themselves
 * (they have it in their hands and scanned it), and only of kit that is out
 * with someone else.
 */
export function canRecordHandover(
  item: { status: string; holder_member_id: string | null },
  actor: CustodyActor,
  toMemberId: string,
): { ok: true } | { ok: false; status: 403 | 409; error: string } {
  if (item.status !== "on_loan") {
    return { ok: false, status: 409, error: "This item is in storage. A committee member checks it out to you." };
  }
  if (item.holder_member_id === toMemberId) {
    return { ok: false, status: 409, error: toMemberId === actor.id ? "You already have this item." : "They already have this item." };
  }
  if (actor.handlesKit || actor.id === toMemberId) return { ok: true };
  return {
    ok: false,
    status: 403,
    error: "The person taking it scans it to confirm they have it, or a committee member records the handover.",
  };
}
