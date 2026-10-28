import { ROTA_FIELDS, type RotaField } from "@/lib/rota";
import type { Values } from "@/lib/walkSheet";

/** The sign-up cells of a walk, as read, with a key for every rota field. */
export type LeaderCells = Record<RotaField, string>;

export function leaderCells(values: Values): LeaderCells {
  return Object.fromEntries(ROTA_FIELDS.map((f) => [f, (values[f] ?? "").trim()])) as LeaderCells;
}

export const sameLeaders = (a: LeaderCells, b: LeaderCells) => ROTA_FIELDS.every((f) => (a[f] ?? "") === (b[f] ?? ""));

/** More walks than this changing their sign-ups in one sync looks like a restore, not people signing up. */
export const MASS_CHANGE_WALKS = 6;

export interface LeaderChange {
  field: RotaField;
  /** What the sheet has now. */
  now: string;
  /** What the history has for the chosen moment. */
  then: string;
}

/** The cells that differ between the sheet now and an earlier record, in rota order. */
export function leaderChanges(now: LeaderCells, then: LeaderCells): LeaderChange[] {
  return ROTA_FIELDS.filter((f) => (now[f] ?? "") !== (then[f] ?? "")).map((field) => ({ field, now: now[field] ?? "", then: then[field] ?? "" }));
}

export interface HistoryRow {
  row_key: string;
  cells: LeaderCells;
  seen_at: string;
}

/** The newest record per walk at or before `asOf`. */
export function historyAsOf(rows: HistoryRow[], asOf: string): Map<string, HistoryRow> {
  const out = new Map<string, HistoryRow>();
  for (const r of rows) {
    if (r.seen_at > asOf) continue;
    const kept = out.get(r.row_key);
    if (!kept || r.seen_at > kept.seen_at) out.set(r.row_key, r);
  }
  return out;
}
