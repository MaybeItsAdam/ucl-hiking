import type {
  Equipment,
  EquipmentRequest,
  Member,
  SUEvent,
  Walk,
  WalkRegistration,
  WalkRegistrationStatus,
} from "./types";

// In-memory singletons for local dev
const devWalks: Walk[] = [];
const devRegistrations: WalkRegistration[] = [];
const devEquipment: Equipment[] = [];
const devRequests: EquipmentRequest[] = [];
const devEvents: SUEvent[] = [];
const devMembers: Member[] = [];

export function getDevWalks(): Walk[] {
  return devWalks;
}

export function addDevWalk(walk: Omit<Walk, "id"> & { id?: string }): Walk {
  const newWalk: Walk = {
    ...walk,
    id: walk.id || `dev-walk-${Date.now()}`,
    spaces_remaining: walk.capacity,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  devWalks.push(newWalk);
  return newWalk;
}

export function getDevBookings(memberId: string): WalkRegistration[] {
  return devRegistrations
    .filter((r) => r.member_id === memberId && (r.status === "confirmed" || r.status === "waitlist"))
    .map((r) => ({
      ...r,
      walk: devWalks.find((w) => w.id === r.walk_id),
    }));
}

export function registerDevWalk(
  member: Member,
  walkId: string,
): { ok: boolean; status?: WalkRegistrationStatus; error?: string } {
  const walk = devWalks.find((w) => w.id === walkId);
  if (!walk) return { ok: false, error: "Walk not found" };

  const existing = devRegistrations.find(
    (r) => r.walk_id === walkId && r.member_id === member.id && ["confirmed", "waitlist"].includes(r.status),
  );
  if (existing) {
    return { ok: false, error: `You are already ${existing.status} for this walk.` };
  }

  const status: WalkRegistrationStatus = walk.spaces_remaining > 0 ? "confirmed" : "waitlist";
  if (status === "confirmed") {
    walk.spaces_remaining = Math.max(0, walk.spaces_remaining - 1);
  }

  const now = new Date().toISOString();
  devRegistrations.push({
    walk_id: walkId,
    member_id: member.id,
    status,
    created_at: now,
    updated_at: now,
    walk,
    member,
  });

  return { ok: true, status };
}

export function cancelDevWalkRegistration(
  member: Member,
  walkId: string,
): { ok: boolean; error?: string; waitlistPromoted?: string | null } {
  const regIndex = devRegistrations.findIndex(
    (r) => r.walk_id === walkId && r.member_id === member.id && ["confirmed", "waitlist"].includes(r.status),
  );
  if (regIndex === -1) return { ok: false, error: "No active booking found to cancel." };

  const reg = devRegistrations[regIndex];
  const wasConfirmed = reg.status === "confirmed";
  reg.status = "cancelled";
  reg.updated_at = new Date().toISOString();

  let waitlistPromoted: string | null = null;
  const walk = devWalks.find((w) => w.id === walkId);

  if (wasConfirmed && walk) {
    const nextWaitlist = devRegistrations.find((r) => r.walk_id === walkId && r.status === "waitlist");
    if (nextWaitlist) {
      nextWaitlist.status = "confirmed";
      nextWaitlist.updated_at = new Date().toISOString();
      waitlistPromoted = nextWaitlist.member_id;
    } else {
      walk.spaces_remaining = Math.min(walk.capacity, walk.spaces_remaining + 1);
    }
  }

  return { ok: true, waitlistPromoted };
}

export function getDevWalkAttendees(walkId: string) {
  return devRegistrations
    .filter((r) => r.walk_id === walkId && (r.status === "confirmed" || r.status === "waitlist"))
    .map((r) => ({
      member_id: r.member_id,
      status: r.status,
      created_at: r.created_at,
      member: devMembers.find((m) => m.id === r.member_id) || {
        id: r.member_id,
        full_name: "Club Member",
        email: "member@ucl.ac.uk",
        membership_tier: "standard",
      },
    }));
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

export function getDevMembers(search?: string, tier?: string, role?: string): Member[] {
  let list = [...devMembers];
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(
      (m) => m.full_name?.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }
  if (tier) {
    list = list.filter((m) => m.membership_tier === tier);
  }
  if (role === "leader") {
    list = list.filter((m) => m.is_walk_leader);
  } else if (role) {
    list = list.filter((m) => m.governance_role === role);
  }
  return list;
}

export function getDevMemberCounts() {
  const counts = { taster: 0, standard: 0, explorer: 0, leaders: 0 };
  for (const m of devMembers) {
    if (m.membership_tier === "taster") counts.taster++;
    else if (m.membership_tier === "standard") counts.standard++;
    else if (m.membership_tier === "explorer") counts.explorer++;
    if (m.is_walk_leader) counts.leaders++;
  }
  return counts;
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
