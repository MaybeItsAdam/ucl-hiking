import type { SupabaseClient } from "@supabase/supabase-js";
import type { GovernanceRole } from "@/lib/access";
import { mayHold, normalizeRestriction, restrictionError } from "@/lib/kitCustody";

/**
 * NFC-tagged club kit: one physical item (a tent, a stove) under an equipment
 * type. Untagged stock keeps working as plain counts on `equipment`.
 *
 * A committee member scans items out of storage to a member (check_out:
 * against a booked loan at the pickup, or straight off the shelf with
 * `hand_out`), records them passing from one member to another (`transfer`,
 * a 'handover' event), and scans them back into storage (check_in). Each item
 * knows who holds it; lib/kitCustody has the rules for who may do what.
 * Loans stay requests: stock counts move with the request's status (booked or
 * out holds it, returned gives it back), never with a scan. The one exception
 * is the database marking a booked loan out when its first item is handed over.
 *
 * The database holds the caps (migration 20261007000000_equipment_items): never
 * more tagged items than a type's total, never more items out on a request than
 * its quantity, only against an approved request for the same type. This module
 * plans each action from what it has read, so the lender gets a plain reason,
 * and the database has the last word.
 */

export const ITEM_STATUSES = ["available", "on_loan", "maintenance", "missing"] as const;
export const ITEM_CONDITIONS = ["good", "fair", "needs_repair"] as const;
/** What an item's history records (equipment_item_events.action). */
export const ITEM_ACTIONS = ["tagged", "check_out", "handover", "check_in", "audit", "flag"] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];
export type ItemAction = (typeof ITEM_ACTIONS)[number];

/** Most scans the offline queue may send in one batch. */
export const MAX_BATCH_OPS = 200;

export interface EquipmentItem {
  id: string;
  equipment_id: string;
  tag_uid: string | null;
  asset_code: string;
  label: string | null;
  location: string | null;
  status: ItemStatus;
  condition: ItemCondition;
  loan_request_id: string | null;
  holder_member_id?: string | null;
  last_audited_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** The loan an item is out on, as the phone shows it. */
export interface ItemLoan {
  request_id: string;
  borrower: string | null;
  start_date: string;
  end_date: string;
}

/** One item as the phone caches it: the item plus its type and current loan. */
export interface ItemSummary {
  id: string;
  equipment_id: string;
  equipment_name: string;
  category: string;
  tag_uid: string | null;
  asset_code: string;
  label: string | null;
  location: string | null;
  status: ItemStatus;
  condition: ItemCondition;
  last_audited_at: string | null;
  notes: string | null;
  updated_at: string;
  loan: ItemLoan | null;
  /** Who has it now: the borrower, or whoever it was passed to. Null in storage. */
  holder?: { id: string; name: string | null } | null;
  /** The type's restriction (see lib/kitCustody); null when anyone may borrow it. */
  restricted_to?: GovernanceRole[] | null;
}

export function isItemCondition(value: unknown): value is ItemCondition {
  return typeof value === "string" && (ITEM_CONDITIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Tags and asset codes
// ---------------------------------------------------------------------------

/**
 * A tag UID in its one stored form: uppercase hex bytes joined by colons,
 * 4 to 10 bytes (`04:A1:2B:3C:4D:5E:6F`). Accepts `04a12b…`, `04:a1:…`,
 * `04 A1 …` and `04-A1-…`. Separated input must be whole bytes (`4:A1` is
 * rejected rather than guessed at). Anything else is null.
 */
export function normalizeTagUid(input: string): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[\s:-]+/);
  let hex: string;
  if (parts.length > 1) {
    if (!parts.every((p) => /^[0-9a-fA-F]{2}$/.test(p))) return null;
    hex = parts.join("");
  } else {
    hex = trimmed;
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  }
  const bytes = hex.length / 2;
  if (bytes < 4 || bytes > 10) return null;
  return hex.toUpperCase().match(/../g)!.join(":");
}

/** A typed asset code, uppercased; null if it isn't letters, digits and dashes. */
export function normalizeAssetCode(input: string): string | null {
  const code = input.trim().toUpperCase().replace(/\s+/g, "-");
  return /^[A-Z0-9][A-Z0-9-]{0,39}$/.test(code) ? code : null;
}

/**
 * The start of an asset code for a type: its first two words, five letters
 * each. "Tent" → TENT, "Sleeping bag" → SLEEP-BAG, "Head torch" → HEAD-TORCH.
 */
export function assetCodePrefix(typeName: string): string {
  const words = typeName
    .toUpperCase()
    .replace(/[^A-Z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.slice(0, 5));
  return words.length ? words.join("-") : "KIT";
}

/** The next free code for a prefix: TENT-01, TENT-02, … after the highest used. */
export function nextAssetCode(prefix: string, existing: string[]): string {
  const pattern = new RegExp(`^${prefix.replace(/[-]/g, "\\-")}-(\\d+)$`);
  let highest = 0;
  for (const code of existing) {
    const m = pattern.exec(code);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `${prefix}-${String(highest + 1).padStart(2, "0")}`;
}

/**
 * Why another item of a type can't be tagged: every one already is, named by
 * code, so an item filed under the wrong type is there to see.
 */
export function typeFullMessage(typeName: string, total: number, codes: string[]): string {
  const listed = codes.length ? `: ${codes.join(", ")}` : "";
  return (
    `All ${total} ${typeName} are already tagged${listed}. ` +
    `If one of those isn't a ${typeName}, open it and delete it, then tag it again under the right type; ` +
    `otherwise raise the total for ${typeName} first.`
  );
}

/**
 * A typed asset code that follows another type's numbering (PREFIX-NN) and not
 * this one's. Null when it fits, or is a code of no type's pattern.
 */
export function codeTypeMismatch(
  code: string,
  type: { id: string; name: string },
  types: { id: string; name: string }[],
): string | null {
  const numbered = /^(.*)-\d+$/.exec(code);
  if (!numbered) return null;
  const prefix = numbered[1];
  if (prefix === assetCodePrefix(type.name)) return null;
  const owner = types.find((t) => t.id !== type.id && assetCodePrefix(t.name) === prefix);
  if (!owner) return null;
  return `${code} is numbered like a ${owner.name}, but you chose ${type.name}. Pick the right kit type, or leave the code blank.`;
}

/** What a lender calls an item: its label if it has one, else its asset code. */
export function itemName(item: { asset_code: string; label: string | null }): string {
  return item.label?.trim() || item.asset_code;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * When a scan happened, from the phone's clock. Missing or unreadable → now;
 * in the future (a phone clock running fast) → now.
 */
export function clampAt(at: unknown, now: Date = new Date()): string {
  if (typeof at === "string" || typeof at === "number") {
    const t = new Date(at).getTime();
    if (Number.isFinite(t)) return new Date(Math.min(t, now.getTime())).toISOString();
  }
  return now.toISOString();
}

/** The phone's idempotency key, if it sent a usable one. */
export function cleanClientId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id && id.length <= 128 ? id : null;
}

function cleanText(value: unknown, max = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
}

export type ActionInput =
  | { action: "check_out"; requestId: string }
  /** Straight off the shelf to someone, with no request first. */
  | { action: "hand_out"; toMemberId: string; endDate?: string; purpose?: string }
  /** From whoever has it to someone else. */
  | { action: "transfer"; toMemberId: string; notes?: string }
  | { action: "check_in"; condition?: ItemCondition; notes?: string }
  | { action: "audit"; location?: string }
  | { action: "flag"; condition: ItemCondition; notes?: string };

const MEMBER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read an action from a request body. */
export function parseActionInput(raw: unknown): { ok: true; input: ActionInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Send an action." };
  const body = raw as Record<string, unknown>;
  const condition = body.condition;
  if (condition !== undefined && condition !== null && !isItemCondition(condition)) {
    return { ok: false, error: "Condition must be good, fair or needs_repair." };
  }
  switch (body.action) {
    case "check_out": {
      const requestId = cleanText(body.requestId, 64);
      if (!requestId) return { ok: false, error: "Choose the loan request this item is being handed over for." };
      return { ok: true, input: { action: "check_out", requestId } };
    }
    case "hand_out":
    case "transfer": {
      const toMemberId = cleanText(body.toMemberId, 64);
      if (!toMemberId || !MEMBER_ID.test(toMemberId)) return { ok: false, error: "Choose who is taking it." };
      if (body.action === "transfer") return { ok: true, input: { action: "transfer", toMemberId, notes: cleanText(body.notes) } };
      const endDate = cleanText(body.endDate, 10);
      if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return { ok: false, error: "Say when it's due back as a date." };
      return { ok: true, input: { action: "hand_out", toMemberId, endDate, purpose: cleanText(body.purpose, 200) } };
    }
    case "check_in":
      return {
        ok: true,
        input: { action: "check_in", condition: isItemCondition(condition) ? condition : undefined, notes: cleanText(body.notes) },
      };
    case "audit":
      return { ok: true, input: { action: "audit", location: cleanText(body.location, 200) } };
    case "flag":
      if (!isItemCondition(condition)) return { ok: false, error: "Say what condition the item is in." };
      return { ok: true, input: { action: "flag", condition, notes: cleanText(body.notes) } };
    default:
      return { ok: false, error: "Unknown action. Use check_out, hand_out, transfer, check_in, audit or flag." };
  }
}

export interface CommissionInput {
  tagUid: string | null;
  equipmentId: string;
  assetCode: string | null;
  label?: string;
  location?: string;
  notes?: string;
}

/** Read a commissioning request: a tag (optional) for an equipment type. */
export function parseCommissionInput(raw: unknown): { ok: true; input: CommissionInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Send the tag and the kit type." };
  const body = raw as Record<string, unknown>;
  const equipmentId = cleanText(body.equipmentId, 64);
  if (!equipmentId) return { ok: false, error: "Choose which kind of kit this item is." };
  let tagUid: string | null = null;
  const rawTag = body.tagUid ?? body.uid;
  if (rawTag !== undefined && rawTag !== null && rawTag !== "") {
    tagUid = typeof rawTag === "string" ? normalizeTagUid(rawTag) : null;
    if (!tagUid) return { ok: false, error: "That doesn't look like an NFC tag ID. Scan the tag again." };
  }
  let assetCode: string | null = null;
  if (typeof body.assetCode === "string" && body.assetCode.trim()) {
    assetCode = normalizeAssetCode(body.assetCode);
    if (!assetCode) return { ok: false, error: "Asset codes are letters, numbers and dashes, like TENT-03." };
  }
  return {
    ok: true,
    input: {
      tagUid,
      equipmentId,
      assetCode,
      label: cleanText(body.label, 120),
      location: cleanText(body.location, 200),
      notes: cleanText(body.notes),
    },
  };
}

// ---------------------------------------------------------------------------
// Planning: what an action changes, or why it can't happen
// ---------------------------------------------------------------------------

/** The request a check-out is against, as read. */
export interface LoanRequestContext {
  id: string;
  status: string;
  equipment_id: string;
  equipment_name: string;
  quantity: number;
  borrower: string | null;
  /** Items already out on this request, not counting the one being scanned. */
  itemsOut: number;
  /** The borrower, who becomes the holder; and their role, for restricted kit. */
  borrower_id?: string | null;
  borrower_role?: GovernanceRole | null;
}

export interface ItemPatch {
  status?: ItemStatus;
  condition?: ItemCondition;
  location?: string | null;
  notes?: string | null;
  loan_request_id?: string | null;
  holder_member_id?: string | null;
  last_audited_at?: string;
}

export interface PlannedEvent {
  action: ItemAction;
  request_id: string | null;
  location: string | null;
  condition: ItemCondition | null;
  notes: string | null;
  /** Custody: whose hands it left and whose it went to (null: storage). */
  from_member_id?: string | null;
  to_member_id?: string | null;
}

export type Plan =
  | { ok: true; noop: false; patch: ItemPatch; event: PlannedEvent }
  /** Nothing to change (a repeat scan); say so, but it isn't an error. */
  | { ok: true; noop: true; message: string }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

interface PlanItem {
  asset_code: string;
  label: string | null;
  status: ItemStatus;
  condition: ItemCondition;
  equipment_id: string;
  equipment_name: string;
  loan_request_id: string | null;
  holder_member_id?: string | null;
}

/** The person an item is going to, as read, for hand_out and transfer. */
export interface Recipient {
  id: string;
  name: string | null;
  role: GovernanceRole | null;
}

/** What planning needs beyond the item and the request. */
export interface PlanContext {
  /** The item's type's restriction. */
  restrictedTo?: readonly GovernanceRole[] | null;
  /** For hand_out and transfer: who it's going to; null if they weren't found. */
  recipient?: Recipient | null;
}

function event(action: ItemAction, fields: Partial<PlannedEvent> = {}): PlannedEvent {
  return { action, request_id: null, location: null, condition: null, notes: null, ...fields };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Plan an action on an item. `at` is the (clamped) scan time; `request` is the
 * loan request for a check-out, null if it wasn't found.
 */
export function planAction(
  item: PlanItem,
  input: ActionInput,
  at: string,
  request: LoanRequestContext | null = null,
  ctx: PlanContext = {},
): Plan {
  const name = itemName(item);
  const restricted = normalizeRestriction(ctx.restrictedTo ?? null);
  switch (input.action) {
    case "check_out": {
      if (item.status === "on_loan") {
        if (item.loan_request_id === input.requestId) {
          return { ok: true, noop: true, message: `${name} is already handed over on this loan.` };
        }
        return { ok: false, status: 409, error: `${name} is already out on another loan. Scan it back in before lending it again.` };
      }
      if (item.status === "maintenance") {
        return { ok: false, status: 409, error: `${name} is marked for repair. Fix it and flag it good or fair before lending it.` };
      }
      if (!request) return { ok: false, status: 404, error: "That loan request wasn't found." };
      if (request.status === "pending") {
        return { ok: false, status: 409, error: "This request hasn't been booked yet. Book the pickup before handing kit over." };
      }
      if (request.status !== "approved" && request.status !== "booked") {
        return { ok: false, status: 409, error: `This request is ${request.status}, so kit can't be handed over against it.` };
      }
      if (request.equipment_id !== item.equipment_id) {
        return {
          ok: false,
          status: 409,
          error: `${name} is a ${item.equipment_name}, but this request is for ${request.equipment_name}.`,
        };
      }
      if (request.itemsOut >= request.quantity) {
        return {
          ok: false,
          status: 409,
          error: `This request is for ${plural(request.quantity, "item")}, and ${request.itemsOut === 1 ? "it has" : "all have"} already been handed over.`,
        };
      }
      if (restricted && request.borrower_role !== undefined && !mayHold(restricted, request.borrower_role)) {
        return { ok: false, status: 403, error: restrictionError(item.equipment_name, restricted, request.borrower ?? "the borrower") };
      }
      // A scan proves a 'missing' item has turned up, so it can go out.
      const holder = request.borrower_id ?? null;
      return {
        ok: true,
        noop: false,
        patch: { status: "on_loan", loan_request_id: request.id, ...(holder ? { holder_member_id: holder } : {}) },
        event: event("check_out", {
          request_id: request.id,
          to_member_id: holder,
          notes: item.status === "missing" ? "Was marked missing; found at handover." : null,
        }),
      };
    }

    case "hand_out": {
      if (item.status === "on_loan") {
        return { ok: false, status: 409, error: `${name} is already out. Scan it back in, or pass it on, instead.` };
      }
      if (item.status === "maintenance") {
        return { ok: false, status: 409, error: `${name} is marked for repair. Fix it and flag it good or fair before lending it.` };
      }
      const to = ctx.recipient;
      if (!to) return { ok: false, status: 404, error: "That member wasn't found." };
      if (!mayHold(restricted, to.role)) {
        return { ok: false, status: 403, error: restrictionError(item.equipment_name, restricted, to.name ?? "they") };
      }
      return {
        ok: true,
        noop: false,
        patch: { status: "on_loan", holder_member_id: to.id },
        event: event("check_out", {
          to_member_id: to.id,
          notes: item.status === "missing" ? "Was marked missing; found at handover." : null,
        }),
      };
    }

    case "transfer": {
      if (item.status !== "on_loan") {
        return { ok: false, status: 409, error: `${name} is in storage. Check it out to them instead.` };
      }
      const to = ctx.recipient;
      if (!to) return { ok: false, status: 404, error: "That member wasn't found." };
      if (item.holder_member_id === to.id) {
        return { ok: true, noop: true, message: `${to.name ?? "They"} already ${to.name ? "has" : "have"} ${name}.` };
      }
      if (!mayHold(restricted, to.role)) {
        return { ok: false, status: 403, error: restrictionError(item.equipment_name, restricted, to.name ?? "they") };
      }
      return {
        ok: true,
        noop: false,
        patch: { holder_member_id: to.id },
        event: event("handover", {
          request_id: item.loan_request_id,
          from_member_id: item.holder_member_id ?? null,
          to_member_id: to.id,
          notes: input.notes ?? null,
        }),
      };
    }

    case "check_in": {
      if (item.status !== "on_loan" && item.status !== "missing") {
        return { ok: true, noop: true, message: `${name} is already in.` };
      }
      const condition = input.condition ?? item.condition;
      const patch: ItemPatch = {
        status: condition === "needs_repair" ? "maintenance" : "available",
        loan_request_id: null,
        holder_member_id: null,
      };
      if (input.condition) patch.condition = input.condition;
      if (input.notes) patch.notes = input.notes;
      return {
        ok: true,
        noop: false,
        patch,
        event: event("check_in", {
          request_id: item.loan_request_id,
          from_member_id: item.holder_member_id ?? null,
          condition: input.condition ?? null,
          notes: input.notes ?? null,
        }),
      };
    }

    case "audit": {
      const patch: ItemPatch = { last_audited_at: at };
      if (input.location) patch.location = input.location;
      if (item.status === "missing") patch.status = "available";
      return { ok: true, noop: false, patch, event: event("audit", { location: input.location ?? null }) };
    }

    case "flag": {
      const patch: ItemPatch = { condition: input.condition };
      if (input.notes) patch.notes = input.notes;
      // An item out on loan stays on loan; it goes to repair when it comes back.
      if (item.status !== "on_loan") {
        if (input.condition === "needs_repair") patch.status = "maintenance";
        else if (item.status === "maintenance") patch.status = "available";
      }
      return {
        ok: true,
        noop: false,
        patch,
        event: event("flag", { condition: input.condition, notes: input.notes ?? null }),
      };
    }
  }
}

/** Database guard errors (see the migration), in the words the app shows. */
export function describeDbError(
  error: { message?: string; code?: string; details?: string } | null | undefined,
  ctx: { itemName?: string; typeName?: string } = {},
): { status: 404 | 409 | 500; error: string } {
  const message = error?.message ?? "";
  const thing = ctx.typeName ? ctx.typeName : "this kit type";
  if (message.includes("item_limit")) {
    const total = /total=(\d+)/.exec(error?.details ?? "")?.[1];
    return {
      status: 409,
      error: `Every ${thing} is already tagged${total ? ` (${total} in total)` : ""}. Raise the total for ${thing} before tagging another.`,
    };
  }
  if (message.includes("loan_full")) return { status: 409, error: "Every item on this request has already been handed over." };
  if (message.includes("loan_not_approved")) {
    return { status: 409, error: "This request isn't approved any more, so kit can't be handed over against it. Refresh and check." };
  }
  if (message.includes("loan_wrong_type")) return { status: 409, error: "This item isn't the kind of kit the request is for." };
  if (message.includes("restricted_item")) {
    const allowed = /allowed=([a-z,]+)/.exec(error?.details ?? "")?.[1]?.split(",");
    return { status: 409, error: restrictionError(ctx.itemName ?? thing, normalizeRestriction(allowed ?? ["principal", "admin"]), "they") };
  }
  if (message.includes("insufficient_stock")) {
    return { status: 409, error: `The stock count says no ${thing} is left in storage. Check the inventory numbers.` };
  }
  if (message.includes("stale_item")) {
    return { status: 409, error: `${ctx.itemName ?? "This item"} was changed on another phone just now. Scan it again.` };
  }
  if (error?.code === "23503") return { status: 404, error: "That item or kit type no longer exists." };
  return { status: 500, error: "Couldn't save the scan. Try again." };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const SUMMARY_SELECT = `
  id, equipment_id, tag_uid, asset_code, label, location, status, condition,
  last_audited_at, notes, updated_at, loan_request_id, holder_member_id,
  equipment:equipment_id(name, category, restricted_to),
  holder:holder_member_id(id, full_name),
  loan:loan_request_id(id, start_date, end_date, borrower_name, member:member_id(full_name))
`;

interface SummaryRow extends Omit<ItemSummary, "equipment_name" | "category" | "loan" | "holder" | "restricted_to"> {
  loan_request_id: string | null;
  holder_member_id?: string | null;
  equipment: { name: string; category: string; restricted_to?: GovernanceRole[] | null } | null;
  holder?: { id: string; full_name: string | null } | null;
  loan: {
    id: string;
    start_date: string;
    end_date: string;
    borrower_name: string | null;
    member: { full_name: string | null } | null;
  } | null;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function toSummary(row: SummaryRow): ItemSummary {
  const equipment = one(row.equipment);
  const loan = one(row.loan);
  const member = loan ? one(loan.member) : null;
  const holder = one(row.holder);
  return {
    id: row.id,
    equipment_id: row.equipment_id,
    equipment_name: equipment?.name ?? "Club kit",
    category: equipment?.category ?? "General",
    tag_uid: row.tag_uid,
    asset_code: row.asset_code,
    label: row.label,
    location: row.location,
    status: row.status,
    condition: row.condition,
    last_audited_at: row.last_audited_at,
    notes: row.notes,
    updated_at: row.updated_at,
    loan:
      loan && row.status === "on_loan"
        ? {
            request_id: loan.id,
            borrower: member?.full_name || loan.borrower_name || null,
            start_date: loan.start_date,
            end_date: loan.end_date,
          }
        : null,
    holder: holder && row.status === "on_loan" ? { id: holder.id, name: holder.full_name } : null,
    restricted_to: normalizeRestriction(equipment?.restricted_to ?? null),
  };
}

/** Every item, for the phone's offline lookup cache. */
export async function listItemSummaries(supabase: SupabaseClient): Promise<ItemSummary[]> {
  const { data, error } = await supabase.from("equipment_items").select(SUMMARY_SELECT).order("asset_code");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as SummaryRow[]).map(toSummary);
}

/** The items a member holds now. */
export async function listHeldItems(supabase: SupabaseClient, memberId: string): Promise<ItemSummary[]> {
  const { data, error } = await supabase
    .from("equipment_items")
    .select(SUMMARY_SELECT)
    .eq("holder_member_id", memberId)
    .order("asset_code");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as SummaryRow[]).map(toSummary);
}

async function summaryById(supabase: SupabaseClient, id: string): Promise<ItemSummary | null> {
  const { data } = await supabase.from("equipment_items").select(SUMMARY_SELECT).eq("id", id).maybeSingle();
  return data ? toSummary(data as unknown as SummaryRow) : null;
}

export interface TagLookup {
  item: ItemSummary;
  equipment: { id: string; name: string; category: string; total_quantity: number; available_quantity: number };
  loan:
    | (ItemLoan & { quantity: number; items_out: number; status: string })
    | null;
}

/**
 * What any member sees when they scan a tag: what it is, whether it's in
 * storage or with someone (by name), and whether they can confirm they've been
 * handed it. No dates, notes, location or loan details: those are the
 * committee's.
 */
export interface PublicItemView {
  item: Pick<ItemSummary, "id" | "asset_code" | "label" | "equipment_name" | "category" | "status" | "condition"> & {
    holder: { id: string; name: string | null } | null;
    restricted_to: GovernanceRole[] | null;
  };
  /** You have it now. */
  yours: boolean;
  /** It's out with someone else, and you may take it from them. */
  canClaim: boolean;
  /** Restricted kit you can't have; why, in words. */
  restricted: string | null;
}

export function toPublicView(item: ItemSummary, viewer: { id: string; role: GovernanceRole | null }): PublicItemView {
  const restrictedTo = normalizeRestriction(item.restricted_to ?? null);
  const holder = item.status === "on_loan" ? (item.holder ?? null) : null;
  const yours = holder?.id === viewer.id;
  const allowed = mayHold(restrictedTo, viewer.role);
  return {
    item: {
      id: item.id,
      asset_code: item.asset_code,
      label: item.label,
      equipment_name: item.equipment_name,
      category: item.category,
      status: item.status,
      condition: item.condition,
      holder,
      restricted_to: restrictedTo,
    },
    yours,
    canClaim: item.status === "on_loan" && !yours && allowed,
    restricted: allowed ? null : restrictionError(item.equipment_name, restrictedTo),
  };
}

/** An item by its tag, with its type and loan; null if the tag isn't registered. */
export async function lookupByTag(supabase: SupabaseClient, uid: string): Promise<TagLookup | null> {
  return lookupItem(supabase, "tag_uid", uid);
}

/** The same, by the item's id. */
export async function lookupById(supabase: SupabaseClient, id: string): Promise<TagLookup | null> {
  if (!MEMBER_ID.test(id)) return null;
  return lookupItem(supabase, "id", id);
}

async function lookupItem(supabase: SupabaseClient, column: "tag_uid" | "id", value: string): Promise<TagLookup | null> {
  const { data, error } = await supabase.from("equipment_items").select(SUMMARY_SELECT).eq(column, value).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const item = toSummary(data as unknown as SummaryRow);
  const [{ data: eq }, loanInfo] = await Promise.all([
    supabase
      .from("equipment")
      .select("id, name, category, total_quantity, available_quantity")
      .eq("id", item.equipment_id)
      .single(),
    item.loan ? loanCounts(supabase, item.loan.request_id) : Promise.resolve(null),
  ]);
  return {
    item,
    equipment: eq ?? { id: item.equipment_id, name: item.equipment_name, category: item.category, total_quantity: 0, available_quantity: 0 },
    loan: item.loan && loanInfo ? { ...item.loan, ...loanInfo } : null,
  };
}

async function loanCounts(
  supabase: SupabaseClient,
  requestId: string,
): Promise<{ quantity: number; items_out: number; status: string } | null> {
  const [{ data: req }, { count }] = await Promise.all([
    supabase.from("equipment_requests").select("quantity, status").eq("id", requestId).maybeSingle(),
    supabase.from("equipment_items").select("id", { count: "exact", head: true }).eq("loan_request_id", requestId),
  ]);
  if (!req) return null;
  return { quantity: req.quantity, status: req.status, items_out: count ?? 0 };
}

/** The items currently handed over against each request. */
export async function itemsOutByRequest(
  supabase: SupabaseClient,
  requestIds: string[],
): Promise<Map<string, { id: string; asset_code: string; label: string | null }[]>> {
  const out = new Map<string, { id: string; asset_code: string; label: string | null }[]>();
  if (!requestIds.length) return out;
  const { data, error } = await supabase
    .from("equipment_items")
    .select("id, asset_code, label, loan_request_id")
    .in("loan_request_id", requestIds)
    .order("asset_code");
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const list = out.get(row.loan_request_id) ?? [];
    list.push({ id: row.id, asset_code: row.asset_code, label: row.label });
    out.set(row.loan_request_id, list);
  }
  return out;
}

export type ActionResult =
  | {
      ok: true;
      item: ItemSummary;
      /** The scan had already been applied (same clientId); the item as it is now. */
      duplicate?: boolean;
      /** Nothing needed changing, e.g. scanning in an item that is already in. */
      noop?: boolean;
      message?: string;
      /** After a check-in or check-out: where the request's handover stands. */
      loan?: { requestId: string; itemsOut: number; quantity: number; allBack: boolean };
      /** When the item changed hands: from whom (null: storage) to whom (null: storage). */
      custody?: { fromMemberId: string | null; toMemberId: string | null; requestId: string | null };
    }
  | { ok: false; status: number; error: string; unregistered?: boolean; uid?: string };

async function priorScan(supabase: SupabaseClient, clientId: string | null): Promise<ActionResult | null> {
  if (!clientId) return null;
  const { data } = await supabase.from("equipment_item_events").select("item_id").eq("client_id", clientId).maybeSingle();
  if (!data) return null;
  const item = await summaryById(supabase, data.item_id);
  return item ? { ok: true, item, duplicate: true } : { ok: false, status: 404, error: "That item has been deleted." };
}

interface ActOptions {
  actorId: string;
  clientId: string | null;
  at: string;
}

/** Apply a scan to an item. Re-reads and retries once if another phone got there first. */
export async function applyItemAction(
  supabase: SupabaseClient,
  itemId: string,
  input: ActionInput,
  opts: ActOptions,
): Promise<ActionResult> {
  const prior = await priorScan(supabase, opts.clientId);
  if (prior) return prior;

  for (let attempt = 0; ; attempt++) {
    const { data: row } = await supabase
      .from("equipment_items")
      .select(
        "id, equipment_id, asset_code, label, status, condition, loan_request_id, holder_member_id, updated_at, equipment:equipment_id(name, restricted_to)",
      )
      .eq("id", itemId)
      .maybeSingle();
    if (!row) return { ok: false, status: 404, error: "That item isn't registered." };
    const type = one((row as unknown as { equipment: { name: string; restricted_to?: GovernanceRole[] | null } | null }).equipment);
    const item = {
      ...(row as unknown as EquipmentItem),
      equipment_name: type?.name ?? "kit",
    };

    let request: LoanRequestContext | null = null;
    if (input.action === "check_out") {
      request = await readLoanRequest(supabase, input.requestId, item.id);
    }
    const recipient =
      input.action === "hand_out" || input.action === "transfer" ? await readRecipient(supabase, input.toMemberId) : undefined;

    const plan = planAction(item, input, opts.at, request, { restrictedTo: type?.restricted_to ?? null, recipient });
    if (!plan.ok) return { ok: false, status: plan.status, error: plan.error };
    if (plan.noop) {
      const summary = await summaryById(supabase, item.id);
      if (!summary) return { ok: false, status: 404, error: "That item isn't registered." };
      return { ok: true, item: summary, noop: true, message: plan.message };
    }

    const p_event = { ...plan.event, actor_member_id: opts.actorId, at: opts.at, client_id: opts.clientId };
    let requestId = plan.event.request_id;
    const { data: applied, error } =
      input.action === "hand_out"
        ? await supabase.rpc("equipment_item_hand_out", {
            p_item_id: item.id,
            p_expected: item.updated_at,
            p_loan: { ...handOutLoan(input, opts.at), member_id: input.toMemberId, actor_member_id: opts.actorId },
            p_event,
          })
        : await supabase.rpc("equipment_item_apply", {
            p_item_id: item.id,
            p_expected: item.updated_at,
            p_patch: plan.patch,
            p_event,
          });
    if (error) {
      if (error.message?.includes("stale_item") && attempt === 0) continue;
      const described = describeDbError(error, { itemName: itemName(item), typeName: item.equipment_name });
      if (described.status === 500) console.error(`[equipmentItems] ${input.action} on ${item.id}: ${error.message}`);
      return { ok: false, ...described };
    }

    const result = applied as { status: string; item_id: string; request_id?: string } | null;
    const summary = await summaryById(supabase, result?.item_id ?? item.id);
    if (!summary) return { ok: false, status: 404, error: "That item has been deleted." };
    if (result?.status === "duplicate") return { ok: true, item: summary, duplicate: true };
    if (result?.request_id) requestId = result.request_id;

    const out: ActionResult = { ok: true, item: summary };
    if (plan.event.from_member_id !== undefined || plan.event.to_member_id !== undefined) {
      out.custody = {
        fromMemberId: plan.event.from_member_id ?? null,
        toMemberId: plan.event.to_member_id ?? null,
        requestId,
      };
    }
    const loanId =
      input.action === "check_out" ? input.requestId : input.action === "check_in" ? item.loan_request_id : input.action === "hand_out" ? requestId : null;
    if (loanId) {
      const counts = await loanCounts(supabase, loanId);
      if (counts) {
        out.loan = { requestId: loanId, itemsOut: counts.items_out, quantity: counts.quantity, allBack: counts.items_out === 0 };
      }
    }
    return out;
  }
}

/** London's calendar day for a moment, as YYYY-MM-DD. */
function londonDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

/** Days a direct hand-out is lent for when nobody says. */
export const DIRECT_LOAN_DAYS = 7;

/** The loan a direct hand-out writes: from today, back by the date given or a week on. */
export function handOutLoan(
  input: { endDate?: string; purpose?: string },
  at: string,
): { start_date: string; end_date: string; purpose: string } {
  const start = londonDate(at);
  const fallback = new Date(Date.parse(`${start}T12:00:00Z`) + DIRECT_LOAN_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const end = input.endDate && input.endDate >= start ? input.endDate : fallback;
  return { start_date: start, end_date: end, purpose: input.purpose || "Handed over in person" };
}

/** A current member, as a recipient of kit; null if there's no such member. */
async function readRecipient(supabase: SupabaseClient, memberId: string): Promise<Recipient | null> {
  const { data } = await supabase
    .from("members")
    .select("id, full_name, governance_role")
    .eq("id", memberId)
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id as string, name: (data.full_name as string | null) ?? null, role: (data.governance_role as GovernanceRole | null) ?? null };
}

async function readLoanRequest(supabase: SupabaseClient, requestId: string, itemId: string): Promise<LoanRequestContext | null> {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return null;
  const [{ data: req }, { count }] = await Promise.all([
    supabase
      .from("equipment_requests")
      .select(
        "id, status, equipment_id, quantity, borrower_name, member_id, equipment:equipment_id(name), member:member_id(full_name, governance_role)",
      )
      .eq("id", requestId)
      .maybeSingle(),
    supabase
      .from("equipment_items")
      .select("id", { count: "exact", head: true })
      .eq("loan_request_id", requestId)
      .neq("id", itemId),
  ]);
  if (!req) return null;
  const r = req as unknown as {
    id: string;
    status: string;
    equipment_id: string;
    quantity: number;
    borrower_name: string | null;
    member_id: string | null;
    equipment: { name: string } | null;
    member: { full_name: string | null; governance_role: GovernanceRole | null } | null;
  };
  const member = one(r.member);
  return {
    id: r.id,
    status: r.status,
    equipment_id: r.equipment_id,
    equipment_name: one(r.equipment)?.name ?? "other kit",
    quantity: r.quantity,
    borrower: member?.full_name || r.borrower_name || null,
    itemsOut: count ?? 0,
    borrower_id: r.member_id,
    borrower_role: member?.governance_role ?? null,
  };
}

/** Tag (commission) a new item under an equipment type. */
export async function commissionItem(
  supabase: SupabaseClient,
  input: CommissionInput,
  opts: ActOptions,
): Promise<ActionResult> {
  const prior = await priorScan(supabase, opts.clientId);
  if (prior) return prior;

  if (input.tagUid) {
    const { data: holder } = await supabase
      .from("equipment_items")
      .select("asset_code, label")
      .eq("tag_uid", input.tagUid)
      .maybeSingle();
    if (holder) return { ok: false, status: 409, error: `That tag is already on ${itemName(holder)}.` };
  }

  const { data: type } = await supabase
    .from("equipment")
    .select("id, name, total_quantity")
    .eq("id", input.equipmentId)
    .maybeSingle();
  if (!type) return { ok: false, status: 404, error: "That kit type wasn't found." };

  const { data: taggedRows } = await supabase
    .from("equipment_items")
    .select("asset_code")
    .eq("equipment_id", type.id)
    .order("asset_code");
  const taggedCodes = (taggedRows ?? []).map((r) => r.asset_code as string);
  if (taggedCodes.length >= type.total_quantity) {
    return { ok: false, status: 409, error: typeFullMessage(type.name, type.total_quantity, taggedCodes) };
  }

  // A typed code that is another kind of kit's numbering (RADIO-06 on a roll
  // mat) means the wrong type was picked; that is how a type fills up with
  // items nobody recognises as its own.
  if (input.assetCode) {
    const { data: types } = await supabase.from("equipment").select("id, name");
    const clash = codeTypeMismatch(input.assetCode, type, types ?? []);
    if (clash) return { ok: false, status: 409, error: clash };
  }

  // A generated code can collide with one made at the same moment; try the next.
  for (let attempt = 0; attempt < 3; attempt++) {
    let assetCode = input.assetCode;
    if (!assetCode) {
      const prefix = assetCodePrefix(type.name);
      const { data: codes } = await supabase.from("equipment_items").select("asset_code").like("asset_code", `${prefix}-%`);
      assetCode = nextAssetCode(prefix, (codes ?? []).map((c) => c.asset_code as string));
    }

    const { data: applied, error } = await supabase.rpc("equipment_item_commission", {
      p_item: {
        equipment_id: type.id,
        tag_uid: input.tagUid,
        asset_code: assetCode,
        label: input.label ?? null,
        location: input.location ?? null,
        notes: input.notes ?? null,
      },
      p_event: { actor_member_id: opts.actorId, at: opts.at, client_id: opts.clientId },
    });

    if (error) {
      if (error.code === "23505") {
        const text = `${error.message} ${error.details ?? ""}`;
        if (text.includes("tag_uid")) {
          const { data: holder } = await supabase
            .from("equipment_items")
            .select("asset_code, label")
            .eq("tag_uid", input.tagUid)
            .maybeSingle();
          return { ok: false, status: 409, error: `That tag is already on ${holder ? itemName(holder) : "another item"}.` };
        }
        if (text.includes("asset_code")) {
          if (input.assetCode) {
            return { ok: false, status: 409, error: `Asset code ${input.assetCode} is already in use. Choose another.` };
          }
          continue;
        }
      }
      if (error.message?.includes("duplicate_client_id")) {
        const again = await priorScan(supabase, opts.clientId);
        if (again) return again;
      }
      const described = describeDbError(error, { typeName: type.name });
      if (described.status === 500) console.error(`[equipmentItems] tagging ${type.id}: ${error.message}`);
      return { ok: false, ...described };
    }

    const result = applied as { status: string; item_id: string };
    const item = await summaryById(supabase, result.item_id);
    if (!item) return { ok: false, status: 500, error: "The item was tagged but couldn't be read back. Refresh." };
    return result.status === "duplicate" ? { ok: true, item, duplicate: true } : { ok: true, item };
  }
  return { ok: false, status: 409, error: "Couldn't find a free asset code. Type one in." };
}

// ---------------------------------------------------------------------------
// Batch (the phone's offline queue)
// ---------------------------------------------------------------------------

export interface BatchOpResult {
  clientId: string | null;
  ok: boolean;
  error?: string;
  item?: ItemSummary;
  duplicate?: boolean;
  noop?: boolean;
  message?: string;
  loan?: { requestId: string; itemsOut: number; quantity: number; allBack: boolean };
  custody?: { fromMemberId: string | null; toMemberId: string | null; requestId: string | null };
  unregistered?: boolean;
  uid?: string;
}

export function toBatchResult(clientId: string | null, result: ActionResult): BatchOpResult {
  if (!result.ok) {
    const { error, unregistered, uid } = result;
    return { clientId, ok: false, error, ...(unregistered ? { unregistered, uid } : {}) };
  }
  const { ok, ...rest } = result;
  return { clientId, ok, ...rest };
}

/** Apply one queued op: find its item (by id or tag), then act or commission. */
export async function applyBatchOp(
  supabase: SupabaseClient,
  raw: unknown,
  actorId: string,
  now: Date = new Date(),
): Promise<BatchOpResult> {
  if (!raw || typeof raw !== "object") return { clientId: null, ok: false, error: "Each op must be an object." };
  const op = raw as Record<string, unknown>;
  const clientId = cleanClientId(op.clientId);
  if (!clientId) return { clientId: typeof op.clientId === "string" ? op.clientId : null, ok: false, error: "Each op needs a clientId." };
  const at = clampAt(op.at, now);
  const opts = { actorId, clientId, at };

  if (op.action === "tagged") {
    const parsed = parseCommissionInput({ ...op, tagUid: op.tagUid ?? op.uid });
    if (!parsed.ok) return { clientId, ok: false, error: parsed.error };
    return toBatchResult(clientId, await commissionItem(supabase, parsed.input, opts));
  }

  const parsed = parseActionInput(op);
  if (!parsed.ok) return { clientId, ok: false, error: parsed.error };
  // Putting kit in someone's hands names them, and they're told: never from a
  // queue that may be sent hours later.
  if (parsed.input.action === "hand_out" || parsed.input.action === "transfer") {
    return { clientId, ok: false, error: "Handing kit to someone needs a signal. Do it again once you're online." };
  }

  let itemId = typeof op.itemId === "string" && op.itemId.trim() ? op.itemId.trim() : null;
  if (!itemId) {
    // A replay of a scan that went through is answered before the tag is looked up.
    const prior = await priorScan(supabase, clientId);
    if (prior) return toBatchResult(clientId, prior);
    const uid = typeof op.uid === "string" ? normalizeTagUid(op.uid) : null;
    if (!uid) return { clientId, ok: false, error: "Each op needs an itemId or a tag uid." };
    const { data } = await supabase.from("equipment_items").select("id").eq("tag_uid", uid).maybeSingle();
    if (!data) return { clientId, ok: false, error: "This tag isn't registered to any item.", unregistered: true, uid };
    itemId = data.id as string;
  }
  return toBatchResult(clientId, await applyItemAction(supabase, itemId, parsed.input, opts));
}

/**
 * A kit type as a lender picks it. Types can share a name (the same rucksack
 * stocked in two colours), so a shared name gets its description's colour, or
 * the whole description, to tell the stock lines apart.
 */
export function equipmentTypeLabel(
  type: { id: string; name: string; description: string | null },
  all: { id: string; name: string }[],
): string {
  const shared = all.some((t) => t.id !== type.id && t.name.trim().toLowerCase() === type.name.trim().toLowerCase());
  const description = type.description?.trim();
  if (!shared || !description) return type.name;
  const colour = /colou?r:\s*([^|]+)/i.exec(description)?.[1]?.trim();
  return `${type.name} (${colour || description})`;
}
