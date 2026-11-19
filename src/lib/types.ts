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
  /** When the counts were last read from the SU; null until a sync since the scraper's retirement. */
  tickets_synced_at?: string | null;
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
  /**
   * The governance roles that may take this kit out; null or absent means
   * anyone who can borrow. Drones are principals and admins only.
   */
  restricted_to?: GovernanceRole[] | null;
  created_at: string;
  updated_at: string;
}

/**
 * A loan's life: pending (asked) → booked (a pickup arranged with a committee
 * member) → approved (the kit is out with the member) → returned. Or rejected /
 * cancelled. "approved" keeps its name in the database, where everything reads
 * it as "kit is out"; the app calls it "On loan".
 */
export type EquipmentRequestStatus = "pending" | "booked" | "approved" | "rejected" | "returned" | "cancelled";

export interface EquipmentRequest {
  id: string;
  /** Null once the borrower has deleted their account; see borrower_name/borrower_email. */
  member_id: string | null;
  equipment_id: string;
  quantity: number;
  start_date: string;
  end_date: string;
  purpose: string;
  status: EquipmentRequestStatus;
  notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  /** When the loan stopped being out (left 'approved'). */
  loan_closed_at?: string | null;
  /** Snapshot taken when the borrower deleted their account. */
  borrower_name?: string | null;
  borrower_email?: string | null;
  /** The pickup a committee member booked: when, where and who they're meeting. */
  pickup_at?: string | null;
  pickup_location?: string | null;
  pickup_with_member_id?: string | null;
  pickup_with?: { id: string; full_name: string | null } | null;
  booked_by?: string | null;
  booked_at?: string | null;
  /** "direct": a committee member took it off the shelf to someone, with no request first. */
  origin?: "request" | "direct";
  created_at: string;
  updated_at: string;
  member?: Member | null;
  equipment?: Equipment;
  /** Approved loans only, for kit lenders: the tagged items handed over against it. */
  items?: { id: string; asset_code: string; label: string | null }[];
}
