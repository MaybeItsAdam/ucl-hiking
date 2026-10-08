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

/** Which claims a member may make: leaders claim as walk leaders, committee as either. */
export function claimKindsFor(profile: AccessProfile): ClaimKind[] {
  const kinds: ClaimKind[] = [];
  if (can(profile, "manage_club")) kinds.push("committee");
  if (can(profile, "lead_walks")) kinds.push("wl");
  return kinds;
}

export interface ClaimFields {
  date: string;
  description: string;
  amount: string;
  /** "yes" when the treasurer already holds their bank details; "" until answered. */
  bankOnFile: "" | "yes" | "no";
  accountName: string;
  sortCode: string;
  accountNumber: string;
  /** New payees: the treasurer's sheet keeps a phone number with the bank details. */
  phone: string;
  /** Walk-leader claims: the name they sign up under on the WL calendar. */
  nickname: string;
  uclEmail: string;
  /** Walk-leader claims: they've filled in the Route Feedback Form for this walk. */
  routeFeedback: boolean;
}

/**
 * Walk-leader claims mirror the WL Google Form: the walk's date and the name
 * they lead under, and the spreadsheet works out the rest from the calendar.
 * Committee claims say what was bought and how much.
 */
export const isWalkLeaderClaim = (kind: ClaimKind) => kind === "wl";

export const isPhone = (phone: string) => /^\+?[\d\s()-]{10,20}$/.test(phone.trim()) && phone.replace(/\D/g, "").length >= 10;

export const isUclEmail = (email: string) => /^[^\s@]+@ucl\.ac\.uk$/i.test(email.trim());

/** The first thing wrong with a claim, in the words the form shows; null when it's ready. */
export function claimProblem(c: ClaimFields, kind: ClaimKind): string | null {
  if (isWalkLeaderClaim(kind)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date)) return "Give the date of the walk.";
    if (!c.nickname.trim()) return "Give the name you use on the WL calendar.";
    if (!isUclEmail(c.uclEmail)) return "Give your UCL email, ending @ucl.ac.uk.";
    if (!c.routeFeedback) return "Fill in the Walk/Hike Route Feedback Form for this walk first.";
  } else {
    const amount = Number(c.amount.replace(/[£,\s]/g, ""));
    if (!/^\d+(\.\d{1,2})?$/.test(c.amount.replace(/[£,\s]/g, "")) || !(amount > 0) || amount > 2000) {
      return "The amount should be in pounds, between £0.01 and £2,000.";
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date)) return "Give the date of purchase.";
    if (!c.description.trim()) return "Describe the purchase.";
  }
  if (!c.bankOnFile) return "Say whether you've sent your bank details before.";
  if (c.bankOnFile === "no") {
    if (!c.accountName.trim()) return "Give the name on the bank account.";
    if (!/^\d{6}$/.test(c.sortCode.replace(/[\s-]/g, ""))) return "The sort code should be 6 digits.";
    if (!/^\d{8}$/.test(c.accountNumber.replace(/\s/g, ""))) return "The account number should be 8 digits.";
    if (!isPhone(c.phone)) return "Give a phone number the treasurer can reach you on.";
    if (!isWalkLeaderClaim(kind) && !isUclEmail(c.uclEmail)) return "Give your UCL email, ending @ucl.ac.uk.";
  }
  return null;
}
