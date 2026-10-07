import { can, type AccessProfile } from "@/lib/access";
import type { ClaimKind } from "@/lib/reimbursementToken";

/** The Google Forms the claims page stands in for; still linked as a fallback. */
export const CLAIM_FORMS: Record<ClaimKind, string> = {
  wl: "https://forms.gle/7orVWNts2oZE79E38",
  committee: "https://forms.gle/wvxYYWBY4mUwTPSS9",
};

export const CLAIM_KIND_LABELS: Record<ClaimKind, string> = {
  wl: "Walk leader",
  committee: "Committee",
};

/** Must match UCLH_APP_CATEGORIES in apps-script/reimbursements/Code.gs. */
export const CLAIM_CATEGORIES = ["Travel", "Equipment", "First aid", "Food and drink", "Printing", "Room or venue", "Other"] as const;

/** Which claims a member may make: leaders claim as walk leaders, committee as either. */
export function claimKindsFor(profile: AccessProfile): ClaimKind[] {
  const kinds: ClaimKind[] = [];
  if (can(profile, "manage_club")) kinds.push("committee");
  if (can(profile, "lead_walks")) kinds.push("wl");
  return kinds;
}

export interface ClaimFields {
  event: string;
  date: string;
  category: string;
  description: string;
  amount: string;
  accountName: string;
  sortCode: string;
  accountNumber: string;
}

/**
 * Only committee claims say what was bought: the walk-leader spreadsheet writes
 * its own description from the day of the walk.
 */
export const asksWhatWasBought = (kind: ClaimKind) => kind === "committee";

/** The first thing wrong with a claim, in the words the form shows; null when it's ready. */
export function claimProblem(c: ClaimFields, kind: ClaimKind): string | null {
  const amount = Number(c.amount.replace(/[£,\s]/g, ""));
  if (!/^\d+(\.\d{1,2})?$/.test(c.amount.replace(/[£,\s]/g, "")) || !(amount > 0) || amount > 2000) {
    return "The amount should be in pounds, between £0.01 and £2,000.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date)) return "Give the date you paid.";
  if (!(CLAIM_CATEGORIES as readonly string[]).includes(c.category)) return "Pick what the money was for.";
  if (asksWhatWasBought(kind) && !c.description.trim()) return "Say what you bought.";
  if (!c.accountName.trim()) return "Give the name on the bank account.";
  if (!/^\d{6}$/.test(c.sortCode.replace(/[\s-]/g, ""))) return "The sort code should be 6 digits.";
  if (!/^\d{8}$/.test(c.accountNumber.replace(/\s/g, ""))) return "The account number should be 8 digits.";
  return null;
}
