import type { ItemCondition } from "@/lib/equipmentItems";
import type { EquipmentRequest } from "@/lib/types";

export const CONDITION_LABELS: Record<ItemCondition, string> = {
  good: "Good",
  fair: "Fair",
  needs_repair: "Needs repair",
};

const dateTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTime.format(d);
}

/** "3 Oct – 5 Oct" for plain YYYY-MM-DD loan dates. */
export function formatDays(start: string, end: string): string {
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${start} – ${end}`;
  return start === end ? day.format(a) : `${day.format(a)} – ${day.format(b)}`;
}

export function borrowerOf(request: EquipmentRequest): string {
  return request.member?.full_name || request.borrower_name || "Club member";
}
