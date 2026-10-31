import { readFileSync } from "node:fs";
import type { EventPlanView } from "./eventPlans";
import type { EventRoute } from "./eventRoutes";
import type { LatLng } from "./places";
import type {
  Equipment,
  EquipmentRequest,
  Member,
  SUEvent,
} from "./types";

// In-memory singletons for local dev
const devEquipment: Equipment[] = [];
const devRequests: EquipmentRequest[] = [];
const devEvents: SUEvent[] = [];
const devMembers: Member[] = [];
const devRoutes = new Map<string, EventRoute>();
const devPlans = new Map<string, EventPlanView>();
const devPlaces = new Map<string, LatLng>();

/**
 * Demo content for local dev without a database, read once from the JSON file
 * DEV_FIXTURES names. scripts/store-assets/capture.mjs writes one to render the
 * store screenshots; nothing sets it otherwise, and production never reads it.
 */
interface DevFixtures {
  events?: SUEvent[];
  equipment?: Equipment[];
  requests?: EquipmentRequest[];
  members?: Member[];
  routes?: EventRoute[];
  plans?: EventPlanView[];
  places?: Record<string, LatLng>;
}

(function seedFromFixtures() {
  const file = process.env.DEV_FIXTURES;
  if (!file || process.env.NODE_ENV === "production") return;
  const data = JSON.parse(readFileSync(file, "utf8")) as DevFixtures;
  devEvents.push(...(data.events ?? []));
  devEquipment.push(...(data.equipment ?? []));
  devRequests.push(...(data.requests ?? []));
  devMembers.push(...(data.members ?? []));
  for (const route of data.routes ?? []) devRoutes.set(route.event_suu_id, route);
  for (const plan of data.plans ?? []) devPlans.set(plan.event_suu_id, plan);
  for (const [place, at] of Object.entries(data.places ?? {})) devPlaces.set(place, at);
})();

export function getDevRoute(eventSuuId: string): EventRoute | null {
  return devRoutes.get(eventSuuId) ?? null;
}

export function getDevPlan(eventSuuId: string): EventPlanView | null {
  return devPlans.get(eventSuuId) ?? null;
}

export function getDevPlaces(keys: string[]): Map<string, LatLng> {
  return new Map(keys.flatMap((key) => (devPlaces.has(key) ? [[key, devPlaces.get(key)!] as const] : [])));
}

export function getDevEquipment(): Equipment[] {
  return devEquipment;
}

export function addDevEquipment(item: Omit<Equipment, "id" | "created_at" | "updated_at">): Equipment {
  const now = new Date().toISOString();
  const newItem: Equipment = {
    ...item,
    id: `dev-eq-${Date.now()}`,
    created_at: now,
    updated_at: now,
  };
  devEquipment.push(newItem);
  return newItem;
}

export function updateDevEquipment(
  id: string,
  updates: Partial<Omit<Equipment, "id" | "created_at" | "updated_at">>,
): Equipment | null {
  const item = devEquipment.find((e) => e.id === id);
  if (!item) return null;
  Object.assign(item, updates, { updated_at: new Date().toISOString() });
  return item;
}

export function deleteDevEquipment(id: string): boolean {
  const index = devEquipment.findIndex((e) => e.id === id);
  if (index === -1) return false;
  devEquipment.splice(index, 1);
  return true;
}

export function upsertDevEquipment(item: {
  id?: string;
  name: string;
  category: string;
  description?: string | null;
  total_quantity: number;
  available_quantity: number;
  condition: "excellent" | "good" | "fair" | "needs_repair";
}): Equipment {
  const existing = item.id
    ? devEquipment.find((e) => e.id === item.id)
    : devEquipment.find((e) => e.name.trim().toLowerCase() === item.name.trim().toLowerCase());
  const now = new Date().toISOString();

  if (existing) {
    Object.assign(existing, {
      name: item.name.trim(),
      category: item.category.trim() || existing.category,
      description: item.description !== undefined ? item.description : existing.description,
      total_quantity: item.total_quantity,
      available_quantity: Math.min(item.available_quantity, item.total_quantity),
      condition: item.condition,
      updated_at: now,
    });
    return existing;
  }

  const newItem: Equipment = {
    id: item.id || `dev-eq-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: item.name.trim(),
    category: item.category.trim() || "General",
    description: item.description || null,
    total_quantity: item.total_quantity,
    available_quantity: Math.min(item.available_quantity, item.total_quantity),
    condition: item.condition,
    created_at: now,
    updated_at: now,
  };
  devEquipment.push(newItem);
  return newItem;
}

export function getDevEquipmentRequests(memberId?: string, isCommittee?: boolean): EquipmentRequest[] {
  if (isCommittee) {
    return devRequests.map((req) => ({
      ...req,
      equipment: devEquipment.find((e) => e.id === req.equipment_id) || req.equipment,
      member: devMembers.find((m) => m.id === req.member_id) || req.member,
    }));
  }
  return devRequests
    .filter((r) => r.member_id === memberId)
    .map((req) => ({
      ...req,
      equipment: devEquipment.find((e) => e.id === req.equipment_id) || req.equipment,
      member: devMembers.find((m) => m.id === req.member_id) || req.member,
    }));
}

export function createDevEquipmentRequest(
  memberId: string,
  equipmentId: string,
  quantity: number,
  startDate: string,
  endDate: string,
  purpose: string,
): EquipmentRequest {
  const now = new Date().toISOString();
  const eq = devEquipment.find((e) => e.id === equipmentId);
  const mem = devMembers.find((m) => m.id === memberId);
  const newReq: EquipmentRequest = {
    id: `dev-req-${Date.now()}`,
    member_id: memberId,
    equipment_id: equipmentId,
    quantity,
    start_date: startDate,
    end_date: endDate,
    purpose,
    status: "pending",
    notes: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: now,
    updated_at: now,
    equipment: eq,
    member: mem,
  };
  devRequests.unshift(newReq);
  return newReq;
}

export function updateDevEquipmentRequestStatus(
  requestId: string,
  status: "approved" | "rejected" | "returned" | "cancelled",
  notes?: string,
  reviewerId?: string,
): EquipmentRequest | null {
  const req = devRequests.find((r) => r.id === requestId);
  if (!req) return null;
  const now = new Date().toISOString();
  req.status = status;
  req.updated_at = now;
  if (notes !== undefined) req.notes = notes;
  if (reviewerId) {
    req.reviewed_by = reviewerId;
    req.reviewed_at = now;
  }
  return req;
}

export function getDevEvents(): SUEvent[] {
  return devEvents;
}

export function getDevMembers(): Member[] {
  return devMembers;
}

let devSheetSettings = {
  webhookUrl: process.env.GOOGLE_SHEET_WEBHOOK_URL || "",
  sheetId: process.env.GOOGLE_SHEET_ID || "",
};

export function getDevSheetSettings() {
  return { ...devSheetSettings };
}

export function setDevSheetSettings(settings: { webhookUrl: string; sheetId?: string }) {
  devSheetSettings = {
    webhookUrl: settings.webhookUrl.trim(),
    sheetId: (settings.sheetId || "").trim(),
  };
  return { ...devSheetSettings };
}
