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

interface DevSessionSettings {
  session_id: string | null;
  auth_state: string | null;
  status: "active" | "expired" | "error" | "unconfigured";
  last_error: string | null;
  last_checked_at: string | null;
  updated_at: string;
}

interface DevSyncRun {
  id: string;
  source: string;
  received_count: number;
  upserted_count: number;
  status: string;
  started_at: string;
  completed_at: string;
}

const devSessionSettings: DevSessionSettings = {
  session_id: "ASP.NET_SessionId=suu-live-sess-8921471048",
  auth_state: null,
  status: "active",
  last_error: null,
  last_checked_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const devMemberSyncRuns: DevSyncRun[] = [
  {
    id: "sync-run-m1",
    source: "cloud-run-job",
    received_count: 42,
    upserted_count: 42,
    status: "success",
    started_at: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 41 * 60 * 1000).toISOString(),
  },
  {
    id: "sync-run-m2",
    source: "cloud-run-job",
    received_count: 41,
    upserted_count: 3,
    status: "success",
    started_at: new Date(Date.now() - 102 * 60 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 101 * 60 * 1000).toISOString(),
  },
];

const devEventSyncRuns: DevSyncRun[] = [
  {
    id: "sync-run-e1",
    source: "su-events-feed",
    received_count: 4,
    upserted_count: 4,
    status: "success",
    started_at: new Date(Date.now() - 55 * 60 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 54 * 60 * 1000).toISOString(),
  },
];

export function getDevSessionInfo() {
  return devSessionSettings;
}

export function updateDevSessionSettings(updates: Partial<DevSessionSettings>) {
  Object.assign(devSessionSettings, updates, { updated_at: new Date().toISOString() });
  return devSessionSettings;
}

export function getDevSyncHistory() {
  return {
    session: devSessionSettings,
    memberSyncs: devMemberSyncRuns,
    eventSyncs: devEventSyncRuns,
  };
}

export function triggerDevSyncRun(target: "members" | "events" | "all") {
  const now = new Date().toISOString();
  if (target === "members" || target === "all") {
    devMemberSyncRuns.unshift({
      id: `sync-run-m-${Date.now()}`,
      source: "manual-trigger",
      received_count: devMembers.length,
      upserted_count: devMembers.length,
      status: "success",
      started_at: now,
      completed_at: now,
    });
  }
  if (target === "events" || target === "all") {
    devEventSyncRuns.unshift({
      id: `sync-run-e-${Date.now()}`,
      source: "manual-trigger",
      received_count: devEvents.length,
      upserted_count: devEvents.length,
      status: "success",
      started_at: now,
      completed_at: now,
    });
  }
  devSessionSettings.last_checked_at = now;
  devSessionSettings.status = "active";
  devSessionSettings.last_error = null;
  return { ok: true, message: `Successfully refreshed ${target} from Students' Union UCL.` };
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
