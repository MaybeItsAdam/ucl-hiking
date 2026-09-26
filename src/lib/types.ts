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
  is_preview?: boolean;
  real_governance_role?: GovernanceRole | null;
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
  description?: string | null;
  location_url?: string | null;
  image_url?: string | null;
  is_all_day?: boolean;
  source?: string | null;
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
