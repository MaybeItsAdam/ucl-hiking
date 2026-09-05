import type { GovernanceRole, MembershipTier } from "@/lib/access";

export interface Member {
  id: string;
  email: string;
  full_name: string | null;
  membership_tier: MembershipTier;
  governance_role: GovernanceRole | null;
  is_walk_leader: boolean;
  membership_expires_at: string | null;
  synced_at: string;
  sync_source: string;
}

export interface Walk {
  id: string;
  title: string;
  location: string;
  starts_at: string;
  distance_km: number;
  ascent_m: number;
  difficulty: "easy" | "moderate" | "challenging";
  capacity: number;
  spaces_remaining: number;
  visibility: "public" | "members" | "explorers";
  summary: string | null;
}

export interface SUEvent {
  id: string;
  suu_event_id: string | null;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  status: "upcoming" | "sold_out" | "cancelled" | "completed" | "draft";
  capacity: number;
  tickets_sold: number;
  price_pence: number;
  source_reference: string | null;
  synced_at: string;
}

export interface SUSessionSettings {
  id: string;
  session_id: string | null;
  auth_state: string | null;
  status: "active" | "expired" | "error" | "unconfigured";
  last_error: string | null;
  last_checked_at: string | null;
  updated_by: string | null;
  updated_at: string;
}

export type EquipmentCondition = "excellent" | "good" | "fair" | "needs_repair";

export interface Equipment {
  id: string;
  name: string;
  category: string;
  description: string | null;
  total_quantity: number;
  available_quantity: number;
  condition: EquipmentCondition;
  created_at: string;
  updated_at: string;
}

export type EquipmentRequestStatus = "pending" | "approved" | "rejected" | "returned" | "cancelled";

export interface EquipmentRequest {
  id: string;
  member_id: string;
  equipment_id: string;
  quantity: number;
  start_date: string;
  end_date: string;
  purpose: string;
  status: EquipmentRequestStatus;
  notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  member?: Member;
  equipment?: Equipment;
}
