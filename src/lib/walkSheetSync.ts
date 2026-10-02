import { randomBytes } from "node:crypto";
import {
  a1,
  addTab,
  appendRows,
  columnLetter,
  formulaCells,
  readValues,
  rowKeys,
  SheetsError,
  spreadsheetTabs,
  tagRows,
  writeCells,
  type CellWrite,
} from "@/lib/googleSheets";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  cellText,
  FIELD_BY_KEY,
  FIELDS,
  findColumn,
  findHeaderRow,
  isWalkKind,
  matchSuEvent,
  nameKey,
  parseSheetDate,
  readCalendar,
  readRoster,
  rosterIndex,
  ROSTER_HEADER,
  ROW_KEY,
  sameValue,
  TABS,
  visibilityFromMembership,
  WALK_SHEETS,
  walkLeaders,
  type FieldDef,
  type RosterEntry,
  type SheetWalk,
  type Values,
  type Visibility,
} from "@/lib/walkSheet";

/**
 * Keeping the app and the club's sheets in step.
 *
 * `pullWalkSheet` reads the committee calendar, the hike planning tab and the
 * WL sign-ups, and folds them into `sheet_walks`. The sheet always wins a
 * field the app hasn't touched. An edit from the app is written to the sheet
 * straight away, after a fresh read: if the cell changed since the editor
 * opened the walk, nothing is overwritten and the walk carries a conflict
 * until someone picks a side.
 */

export interface StoredWalk {
  id: string;
  row_key: string;
  sheet_row: number | null;
  planning_row: number | null;
  signup_row: number | null;
  starts_on: string | null;
  title: string;
  kind: string;
  sheet_values: Values;
  base: Values;
  shown: Values;
  conflicts: Record<string, Conflict>;
  event_suu_id: string | null;
  link_source: "auto" | "manual" | null;
  published: boolean;
  published_source: "sheet" | "app";
  visibility: Visibility;
  visibility_source: "sheet" | "app";
  present: boolean;
  synced_at: string;
}

export interface Conflict {
  sheet: string;
  app: string;
  by: string | null;
  at: string;
}

export interface PullResult {
  walksSeen: number;
  walksChanged: number;
  conflicts: number;
  rosterAdded: number;
  leadersUpdated: number;
}

interface Snapshot {
  walks: (SheetWalk & { signupRow: number | null })[];
  mainSheetId: number;
  columns: { main: Record<string, number>; planning: Record<string, number>; planningDate: number; signups: Record<string, number> };
}

const newKey = () => randomBytes(6).toString("base64url");

/** Read all three tabs into walks with every editable value, tagging any untagged rows. */
async function readSheets(known: StoredWalk[], { tag = true } = {}): Promise<Snapshot> {
  const main = WALK_SHEETS.main;
  const [{ tabs }, rows, formulas, keys] = await Promise.all([
    spreadsheetTabs(main),
    readValues(main, a1(TABS.main, "A1:AZ")),
    readValues(main, a1(TABS.main, "A1:AZ"), "FORMULA"),
    rowKeys(main, TABS.main, ROW_KEY),
  ]);
  const mainTab = tabs.find((t) => t.title === TABS.main);
  if (!mainTab) throw new SheetsError(`The committee calendar has no "${TABS.main}" tab.`);
  const calendar = readCalendar(rows, formulas, keys);
  if (!calendar) throw new SheetsError(`Couldn't find the header row (DATE, EVENT NAME, MEMBERSHIP) on "${TABS.main}".`);

  // Rows without a tag: a new event, or one whose tag was lost (cut and pasted).
  // Reuse the tag of a stored walk on the same date with the same name before minting one.
  const seen = new Set(calendar.walks.map((w) => w.key).filter(Boolean));
  const orphans = known.filter((k) => k.present && !seen.has(k.row_key));
  const tags: { row: number; value: string }[] = [];
  for (const walk of calendar.walks) {
    if (walk.key) continue;
    const i = orphans.findIndex((o) => o.starts_on === walk.date && o.title === walk.title);
    walk.key = i >= 0 ? orphans.splice(i, 1)[0].row_key : newKey();
    tags.push({ row: walk.row, value: walk.key });
  }
  if (tags.length && tag) await tagRows(main, mainTab.sheetId, ROW_KEY, tags);

  // Hike details, from the planning tab rows the calendar points at.
  const [planRows, signRows] = await Promise.all([
    readValues(main, a1(TABS.planning, "A1:AZ")).catch(() => [] as string[][]),
    readValues(WALK_SHEETS.leaders, a1(TABS.signups, "A1:AD")).catch(() => [] as string[][]),
  ]);
  const planHeader = findHeaderRow(planRows, ["what is the name of the hike"]);
  const planning: Record<string, number> = {};
  let planningDate = -1;
  if (planHeader >= 0) {
    for (const f of FIELDS.filter((f) => f.home === "planning")) {
      const c = findColumn(planRows[planHeader], ...f.headers);
      if (c >= 0) planning[f.key] = c;
    }
    planningDate = findColumn(planRows[planHeader], "what is the date of the hike");
  }

  // Leader sign-ups, matched to the calendar by date and name (the WL calendar lists the same events).
  const signHeader = findHeaderRow(signRows, ["date", "event name", "primary wl"]);
  const signups: Record<string, number> = {};
  const signIndex = new Map<string, number>();
  if (signHeader >= 0) {
    const header = signRows[signHeader];
    for (const f of FIELDS.filter((f) => f.home === "signups")) {
      const c = findColumn(header, ...f.headers);
      if (c >= 0) signups[f.key] = c;
    }
    const dateCol = findColumn(header, "date");
    const nameCol = findColumn(header, "event name");
    for (let i = signHeader + 1; i < signRows.length; i++) {
      const date = parseSheetDate(signRows[i]?.[dateCol] ?? "");
      const name = (signRows[i]?.[nameCol] ?? "").trim();
      if (date && name) signIndex.set(`${date}|${name}`, i);
    }
  }

  const walks = calendar.walks.map((walk) => {
    if (walk.planningRow && planHeader >= 0) {
      const row = planRows[walk.planningRow - 1] ?? [];
      for (const [key, col] of Object.entries(planning)) walk.values[key] = row[col] ?? "";
    }
    let signupRow: number | null = null;
    const si = walk.date ? signIndex.get(`${walk.date}|${walk.title}`) : undefined;
    if (si !== undefined && walk.planningRow) {
      signupRow = si + 1;
      for (const [key, col] of Object.entries(signups)) walk.values[key] = signRows[si]?.[col] ?? "";
    }
    return { ...walk, signupRow };
  });

  return { walks, mainSheetId: mainTab.sheetId, columns: { main: calendar.layout.columns, planning, planningDate, signups } };
}

async function storedWalks(): Promise<StoredWalk[]> {
  const { data, error } = await getSupabaseAdmin().from("sheet_walks").select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as StoredWalk[];
}

/** SU events around the calendar's dates, for linking rows to them. */
async function suCandidates(from: string, to: string) {
  const { data } = await getSupabaseAdmin()
    .from("events")
    .select("suu_event_id, title, starts_at")
    .gte("starts_at", `${from}T00:00:00Z`)
    .lte("starts_at", `${to}T23:59:59Z`)
    .not("suu_event_id", "is", null)
    .limit(2000);
  const london = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
  return (data ?? []).map((e) => ({
    suuId: e.suu_event_id as string,
    title: e.title as string,
    date: london.format(new Date(e.starts_at as string)),
  }));
}

/** Fold one read of the sheet into stored walks. Returns the rows to upsert. */
export function mergeWalks(
  snapshot: Pick<Snapshot, "walks">,
  stored: StoredWalk[],
  candidates: { suuId: string; title: string; date: string }[],
  now: string,
): { upserts: Partial<StoredWalk>[]; gone: string[]; changed: number; conflicts: number } {
  const byKey = new Map(stored.map((s) => [s.row_key, s]));
  const taken = new Set(stored.filter((s) => s.present && s.link_source === "manual" && s.event_suu_id).map((s) => s.event_suu_id!));
  const upserts: Partial<StoredWalk>[] = [];
  let changed = 0;
  let conflicts = 0;

  for (const walk of snapshot.walks) {
    const prev = byKey.get(walk.key!);
    const base: Values = { ...(prev?.base ?? {}) };
    const open: Record<string, Conflict> = { ...(prev?.conflicts ?? {}) };
    for (const [field, value] of Object.entries(walk.values)) {
      const c = open[field];
      if (c) {
        // Someone typed the app's value into the sheet, or the sheet moved on again.
        if (sameValue(FIELD_BY_KEY.get(field), value, c.app)) {
          delete open[field];
          base[field] = value;
        } else {
          open[field] = { ...c, sheet: value };
        }
      } else {
        base[field] = value;
      }
    }
    conflicts += Object.keys(open).length;

    let visibility = prev?.visibility ?? visibilityFromMembership(walk.values.membership ?? "");
    if (!prev || prev.visibility_source === "sheet") visibility = visibilityFromMembership(walk.values.membership ?? "");

    let eventSuuId = prev?.event_suu_id ?? null;
    let linkSource = prev?.link_source ?? null;
    if (linkSource !== "manual" && walk.date) {
      const match = matchSuEvent({ date: walk.date, title: walk.title }, candidates.filter((c) => !taken.has(c.suuId)));
      eventSuuId = match?.suuId ?? null;
      linkSource = match ? "auto" : null;
    }
    if (eventSuuId) taken.add(eventSuuId);

    const next: Partial<StoredWalk> = {
      row_key: walk.key!,
      sheet_row: walk.row,
      planning_row: walk.planningRow,
      signup_row: walk.signupRow ?? null,
      starts_on: walk.date,
      title: walk.title,
      kind: walk.kind,
      sheet_values: walk.values,
      base,
      shown: walk.shown,
      conflicts: open,
      event_suu_id: eventSuuId,
      link_source: linkSource,
      visibility,
      present: true,
      synced_at: now,
    };
    // Published follows the sheet's STATUS until the committee flips it in the app.
    next.published = !prev || prev.published_source === "sheet" ? /published/i.test(walk.shown.status ?? "") : prev.published;
    const same =
      prev &&
      prev.present &&
      prev.sheet_row === next.sheet_row &&
      prev.title === next.title &&
      prev.starts_on === next.starts_on &&
      prev.event_suu_id === next.event_suu_id &&
      prev.visibility === next.visibility &&
      prev.published === next.published &&
      JSON.stringify(prev.sheet_values) === JSON.stringify(next.sheet_values) &&
      JSON.stringify(prev.shown) === JSON.stringify(next.shown) &&
      JSON.stringify(prev.conflicts) === JSON.stringify(next.conflicts);
    if (!same) changed += 1;
    upserts.push(next);
  }

  const seen = new Set(snapshot.walks.map((w) => w.key));
  const gone = stored.filter((s) => s.present && !seen.has(s.row_key)).map((s) => s.id);
  return { upserts, gone, changed: changed + gone.length, conflicts };
}

/** What a sync would see, without tagging rows or touching the database. */
export async function previewWalkSheet() {
  const snapshot = await readSheets([], { tag: false });
  return {
    columns: snapshot.columns,
    walks: snapshot.walks.map((w) => ({ ...w, leaders: walkLeaders(w.values, w.shown) })),
  };
}

/** Read the sheets and bring `sheet_walks` and the walk leaders up to date. */
export async function pullWalkSheet(trigger: string): Promise<PullResult> {
  const supabase = getSupabaseAdmin();
  const { data: run } = await supabase.from("sheet_sync_runs").insert({ trigger }).select("id").single();
  const finish = (fields: Record<string, unknown>) =>
    run ? supabase.from("sheet_sync_runs").update({ finished_at: new Date().toISOString(), ...fields }).eq("id", run.id) : null;

  try {
    const stored = await storedWalks();
    const snapshot = await readSheets(stored);
    const dates = snapshot.walks.map((w) => w.date!).sort();
    const candidates = dates.length ? await suCandidates(dates[0], dates.at(-1)!) : [];
    const now = new Date().toISOString();
    const { upserts, gone, changed, conflicts } = mergeWalks(snapshot, stored, candidates, now);

    // Unlink first, so a link moving between rows doesn't trip the one-walk-per-event index.
    if (gone.length) await supabase.from("sheet_walks").update({ present: false, event_suu_id: null }).in("id", gone);
    const before = new Map(stored.map((s) => [s.row_key, s.event_suu_id]));
    const moving = upserts.filter((u) => before.get(u.row_key!) && before.get(u.row_key!) !== u.event_suu_id).map((u) => u.row_key!);
    if (moving.length) await supabase.from("sheet_walks").update({ event_suu_id: null }).in("row_key", moving);
    for (let i = 0; i < upserts.length; i += 200) {
      const { error } = await supabase.from("sheet_walks").upsert(upserts.slice(i, i + 200), { onConflict: "row_key" });
      if (error) throw new Error(error.message);
    }

    const roster = await syncRoster(snapshot.walks).catch((e) => {
      if (e instanceof SheetsError) return { added: 0, updated: 0, error: e.message };
      throw e;
    });

    const result = { walksSeen: snapshot.walks.length, walksChanged: changed, conflicts, rosterAdded: roster.added, leadersUpdated: roster.updated };
    await finish({ ok: true, walks_seen: result.walksSeen, walks_changed: changed, conflicts, error: "error" in roster ? roster.error : null });
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finish({ ok: false, error: message.slice(0, 2000) });
    throw e;
  }
}

/** The last sync, for "synced 3 minutes ago". */
export async function lastSync() {
  const { data } = await getSupabaseAdmin()
    .from("sheet_sync_runs")
    .select("started_at, finished_at, ok, error, walks_seen, conflicts")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { started_at: string; finished_at: string | null; ok: boolean | null; error: string | null; walks_seen: number | null; conflicts: number | null } | null;
}

/** Pull unless a sync finished in the last `maxAgeMs`; never throws. */
export async function pullIfStale(maxAgeMs = 3 * 60_000): Promise<void> {
  const last = await lastSync().catch(() => null);
  if (last?.started_at && Date.now() - Date.parse(last.started_at) < maxAgeMs) return;
  await pullWalkSheet("view").catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Edits from the app

export interface EditResult {
  walk: StoredWalk;
  written: string[];
  conflicts: string[];
}

function cellFor(
  field: FieldDef,
  walk: Snapshot["walks"][number],
  columns: Snapshot["columns"],
): { spreadsheet: string; range: string }[] {
  if (field.home === "main") {
    const col = columns.main[field.key];
    if (col === undefined) return [];
    const cells = [{ spreadsheet: WALK_SHEETS.main, range: a1(TABS.main, `${columnLetter(col)}${walk.row}`) }];
    // A hike's date is also typed on its planning row; keep the two the same.
    if (field.key === "date" && walk.planningRow && columns.planningDate >= 0) {
      cells.push({ spreadsheet: WALK_SHEETS.main, range: a1(TABS.planning, `${columnLetter(columns.planningDate)}${walk.planningRow}`) });
    }
    return cells;
  }
  if (field.home === "planning") {
    const col = columns.planning[field.key];
    return col === undefined || !walk.planningRow ? [] : [{ spreadsheet: WALK_SHEETS.main, range: a1(TABS.planning, `${columnLetter(col)}${walk.planningRow}`) }];
  }
  const col = columns.signups[field.key];
  return col === undefined || !walk.signupRow ? [] : [{ spreadsheet: WALK_SHEETS.leaders, range: a1(TABS.signups, `${columnLetter(col)}${walk.signupRow}`) }];
}

/**
 * Write edits to the sheet. `from` is what the editor saw for each field; if
 * the sheet has moved on since, that field becomes a conflict instead.
 */
export async function editWalk(
  walkId: string,
  edits: Record<string, unknown>,
  from: Record<string, string>,
  editorId: string,
  opts: { force?: boolean } = {},
): Promise<EditResult | { error: string }> {
  const supabase = getSupabaseAdmin();
  const stored = await storedWalks();
  const target = stored.find((s) => s.id === walkId && s.present);
  if (!target) return { error: "That walk isn't on the calendar any more." };

  // Fresh positions and values: rows move when the committee inserts one.
  const snapshot = await readSheets(stored);
  const live = snapshot.walks.find((w) => w.key === target.row_key);
  if (!live) return { error: "That walk has been removed from the calendar." };

  const writes: CellWrite[] = [];
  const written: string[] = [];
  const conflicted: string[] = [];
  const conflicts = { ...target.conflicts };
  const values = { ...live.values };
  const base = { ...target.base };
  const at = new Date().toISOString();

  for (const [key, raw] of Object.entries(edits)) {
    const field = FIELD_BY_KEY.get(key);
    if (!field) return { error: `There's no field called ${key}.` };
    if (!(key in live.values)) return { error: `${field.label} can't be edited from the app for this event.` };
    const text = cellText(field, raw);
    if (!text.ok) return { error: text.error };
    const current = live.values[key] ?? "";
    if (sameValue(field, current, text.text)) {
      delete conflicts[key];
      continue;
    }
    const seen = from[key] ?? target.base[key] ?? "";
    if (!opts.force && !sameValue(field, current, seen)) {
      conflicts[key] = { sheet: current, app: text.text, by: editorId, at };
      conflicted.push(key);
      continue;
    }
    for (const cell of cellFor(field, live, snapshot.columns)) {
      writes.push({ range: cell.range, value: text.text, spreadsheet: cell.spreadsheet } as CellWrite & { spreadsheet: string });
    }
    values[key] = text.text;
    base[key] = text.text;
    delete conflicts[key];
    written.push(key);
  }

  const bySheet = new Map<string, CellWrite[]>();
  for (const w of writes as (CellWrite & { spreadsheet: string })[]) {
    bySheet.set(w.spreadsheet, [...(bySheet.get(w.spreadsheet) ?? []), { range: w.range, value: w.value }]);
  }
  // Last check before writing: never type over a formula.
  for (const [spreadsheet, cells] of bySheet) {
    const locked = await formulaCells(spreadsheet, cells.map((c) => c.range));
    if (locked.size) return { error: "The sheet works that out with a formula, so it can't be changed from the app. Edit it in the sheet." };
  }
  for (const [spreadsheet, cells] of bySheet) await writeCells(spreadsheet, cells);

  const patch: Partial<StoredWalk> = {
    sheet_row: live.row,
    planning_row: live.planningRow,
    signup_row: live.signupRow,
    sheet_values: values,
    base,
    conflicts,
    synced_at: at,
  };
  if (written.includes("date")) patch.starts_on = parseSheetDate(values.date) ?? target.starts_on;
  if (written.includes("membership") && target.visibility_source === "sheet") patch.visibility = visibilityFromMembership(values.membership);
  const { data, error } = await supabase.from("sheet_walks").update(patch).eq("id", walkId).select("*").single();
  if (error) return { error: error.message };
  return { walk: data as StoredWalk, written, conflicts: conflicted };
}

/** Settle a conflict: keep what the sheet says, or write the app's value over it. */
export async function resolveConflict(walkId: string, field: string, keep: "sheet" | "app", editorId: string) {
  const { data } = await getSupabaseAdmin().from("sheet_walks").select("*").eq("id", walkId).maybeSingle();
  const walk = data as StoredWalk | null;
  const conflict = walk?.conflicts?.[field];
  if (!walk || !conflict) return { error: "That conflict has already been settled." };
  if (keep === "sheet") {
    const conflicts = { ...walk.conflicts };
    delete conflicts[field];
    const { data: updated } = await getSupabaseAdmin()
      .from("sheet_walks")
      .update({ conflicts, base: { ...walk.base, [field]: conflict.sheet } })
      .eq("id", walkId)
      .select("*")
      .single();
    return { walk: updated as StoredWalk, written: [], conflicts: [] };
  }
  // The editor has now seen the sheet's value and chosen theirs over it.
  return editWalk(walkId, { [field]: conflict.app }, { [field]: conflict.sheet }, editorId);
}

// ---------------------------------------------------------------------------
// Walk leader roster

/**
 * The WL roster tab: one row per walk leader, as they're written on the
 * calendar, with their email and first aid. The app adds a row for every
 * leader name it sees that isn't there yet; the committee fills in emails.
 * A leader with an email that matches an account becomes a walk leader in
 * the app, with their first aid; dropping them (or Active = FALSE) undoes it.
 */
export async function syncRoster(walks: SheetWalk[]): Promise<{ added: number; updated: number }> {
  const wl = WALK_SHEETS.leaders;
  const { tabs } = await spreadsheetTabs(wl);
  if (!tabs.some((t) => t.title === TABS.roster)) await addTab(wl, TABS.roster, ROSTER_HEADER);
  let roster = readRoster(await readValues(wl, a1(TABS.roster, "A1:G")));
  const index = rosterIndex(roster);

  // Names seen leading in the past year and a bit, not on the roster yet.
  const cutoff = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  const fresh = new Map<string, { name: string; firstAid: boolean }>();
  for (const walk of walks) {
    if (!walk.date || walk.date < cutoff || !isWalkKind(walk.kind)) continue;
    for (const m of walkLeaders(walk.values, walk.shown).leaders) {
      const k = nameKey(m.name);
      if (index.has(k)) continue;
      const had = fresh.get(k);
      fresh.set(k, { name: had?.name ?? m.name, firstAid: Boolean(had?.firstAid || m.firstAid) });
    }
  }
  if (fresh.size) {
    const rows = [...fresh.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => [f.name, "", "", f.firstAid ? "TRUE" : "FALSE", "", "TRUE", "Added by the app from the calendar. Add their email to give them walk leader access."]);
    await appendRows(wl, TABS.roster, rows);
    roster = readRoster(await readValues(wl, a1(TABS.roster, "A1:G")));
  }

  return { added: fresh.size, updated: await applyRoster(roster) };
}

/** Make the roster's leaders walk leaders in the app, with their first aid. */
async function applyRoster(roster: RosterEntry[]): Promise<number> {
  const supabase = getSupabaseAdmin();
  const active = roster.filter((r) => r.active && r.email);
  const emails = [...new Set(active.map((r) => r.email!))];
  const byEmail = new Map(active.map((r) => [r.email!, r]));

  const [{ data: listed }, { data: current }] = await Promise.all([
    emails.length
      ? supabase.from("members").select("id, email, is_walk_leader, wl_name, first_aid_trained, first_aid_until").in("email", emails)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    supabase.from("members").select("id, email").not("wl_name", "is", null),
  ]);

  let updated = 0;
  for (const m of listed ?? []) {
    const entry = byEmail.get(String(m.email).toLowerCase());
    if (!entry) continue;
    const next = {
      is_walk_leader: true,
      walk_leader_locked: true,
      wl_name: entry.name,
      first_aid_trained: entry.firstAid,
      first_aid_until: entry.firstAidUntil,
    };
    if (m.is_walk_leader === true && m.wl_name === next.wl_name && m.first_aid_trained === next.first_aid_trained && (m.first_aid_until ?? null) === next.first_aid_until) continue;
    await supabase.from("members").update(next).eq("id", m.id);
    updated += 1;
  }
  // Leaders the roster no longer lists.
  const keep = new Set(emails);
  for (const m of current ?? []) {
    if (keep.has(String(m.email).toLowerCase())) continue;
    await supabase
      .from("members")
      .update({ is_walk_leader: false, walk_leader_locked: true, wl_name: null, first_aid_trained: false, first_aid_until: null })
      .eq("id", m.id);
    updated += 1;
  }
  return updated;
}

/**
 * The Members page made someone a walk leader, or stopped them being one:
 * say so on the roster, so the sheet stays the list of leaders.
 */
export async function setRosterLeader(
  member: { email: string; full_name: string | null; wl_name: string | null },
  leader: boolean,
): Promise<string | null> {
  const wl = WALK_SHEETS.leaders;
  const { tabs } = await spreadsheetTabs(wl);
  if (!tabs.some((t) => t.title === TABS.roster)) await addTab(wl, TABS.roster, ROSTER_HEADER);
  const roster = readRoster(await readValues(wl, a1(TABS.roster, "A1:G")));
  const email = member.email.toLowerCase();
  const entry =
    roster.find((r) => r.email === email) ??
    (member.wl_name ? roster.find((r) => nameKey(r.name) === nameKey(member.wl_name!)) : undefined);

  if (entry) {
    const writes: CellWrite[] = [{ range: a1(TABS.roster, `F${entry.row}`), value: leader ? "TRUE" : "FALSE" }];
    if (!entry.email) writes.push({ range: a1(TABS.roster, `B${entry.row}`), value: email });
    await writeCells(wl, writes);
    return entry.name;
  }
  if (!leader) return null;
  const name = member.full_name?.trim() || email;
  await appendRows(wl, TABS.roster, [[name, email, "", "FALSE", "", "TRUE", "Added from the app's Members page."]]);
  return name;
}
