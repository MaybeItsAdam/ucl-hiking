import { a1, readValues, spreadsheetTabs } from "@/lib/googleSheets";
import { getSupabaseAdmin } from "@/lib/supabase";
import { nameKey, readRoster, TABS, WALK_SHEETS } from "@/lib/walkSheet";
import { setRosterLeader } from "@/lib/walkSheetSync";

export type RequestStatus = "pending" | "approved" | "declined" | "withdrawn";

export interface WalkLeaderRequest {
  id: string;
  member_id: string;
  wl_name: string | null;
  note: string | null;
  status: RequestStatus;
  decided_at: string | null;
  created_at: string;
}

export const REQUEST_COLUMNS = "id, member_id, wl_name, note, status, decided_at, created_at";

/**
 * Roster names nobody has claimed: active rows with no email, which is every
 * leader the sync added from the calendar until someone links them.
 */
export async function unlinkedRosterNames(): Promise<string[]> {
  const wl = WALK_SHEETS.leaders;
  const { tabs } = await spreadsheetTabs(wl);
  if (!tabs.some((t) => t.title === TABS.roster)) return [];
  const roster = readRoster(await readValues(wl, a1(TABS.roster, "A1:G")));
  return roster
    .filter((r) => r.active && !r.email)
    .map((r) => r.name)
    .sort((a, b) => a.localeCompare(b));
}

/** The unclaimed roster name matching `name`, as the roster spells it. */
export function findUnlinked(names: string[], name: string): string | null {
  const k = nameKey(name);
  return names.find((n) => nameKey(n) === k) ?? null;
}

/**
 * Put a member's walk leadership on the WL roster, so the sheet stays the
 * list of leaders and the daily sync doesn't undo it. Throws if the sheet
 * can't be written.
 */
export async function syncRosterLeader(memberId: string, leader: boolean): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: row } = await supabase.from("members").select("email, full_name, wl_name").eq("id", memberId).single();
  if (!row?.email) return;
  const name = await setRosterLeader(row as { email: string; full_name: string | null; wl_name: string | null }, leader);
  await supabase.from("members").update({ wl_name: leader ? name : null }).eq("id", memberId);
}
