"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, Pencil, RefreshCw } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { FIELDS, VISIBILITY, VISIBILITY_LABELS, type FieldDef, type Values, type Visibility } from "@/lib/walkSheet";

export interface ProgrammeWalk {
  id: string;
  title: string;
  kind: string;
  date: string | null;
  weekday: string;
  day: string;
  month: string;
  hasPlanning: boolean;
  status: string;
  published: boolean;
  publishedFromSheet: boolean;
  visibility: Visibility;
  visibilityFromSheet: boolean;
  sheetVisibility: Visibility;
  eventSuuId: string | null;
  eventId: string | null;
  linkAuto: boolean;
  values: Values;
  conflicts: { field: string; label: string; sheet: string; app: string; by: string | null }[];
  past: boolean;
  isWalk: boolean;
}

export interface ProgrammeEvent {
  suuId: string;
  label: string;
}

const SHEET_URL = "https://docs.google.com/spreadsheets/d/16MiP5dUeHTlARhZnr907YlssCcGi5_51Eq-QmsOP0q8/edit";

/**
 * The committee calendar as the app sees it: every row, whether members can
 * see it and at which rung, which SU event it is, and its details, which save
 * straight back to the sheet.
 */
export function ProgrammeBoard({
  walks,
  events,
  synced,
  syncError,
}: {
  walks: ProgrammeWalk[];
  events: ProgrammeEvent[];
  synced: string | null;
  syncError: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<"upcoming" | "all">("upcoming");
  const [walksOnly, setWalksOnly] = useState(false);
  const [editing, setEditing] = useState<ProgrammeWalk | null>(null);

  const shown = walks.filter((w) => (scope === "all" || !w.past) && (!walksOnly || w.isWalk));
  const months = useMemo(() => {
    const out: { month: string; walks: ProgrammeWalk[] }[] = [];
    for (const w of shown) {
      const last = out.at(-1);
      if (last && last.month === w.month) last.walks.push(w);
      else out.push({ month: w.month, walks: [w] });
    }
    return out;
  }, [shown]);
  const conflicted = walks.filter((w) => w.conflicts.length).length;

  async function patch(id: string, body: unknown, key = id) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/walk-sheet/walks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "That wasn't saved.");
      router.refresh();
      return json as { conflicts?: string[] };
    } catch (e) {
      setError(e instanceof Error ? e.message : "That wasn't saved.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function syncNow() {
    setBusy("sync");
    setError(null);
    try {
      const res = await fetch("/api/sync/walk-sheet", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "The sheet couldn't be read.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The sheet couldn't be read.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="programme-bar">
        <p className="event-meta">
          {syncError ? (
            <span className="programme-sync-error">Last sync failed: {syncError}</span>
          ) : synced ? (
            <>Synced with the committee calendar {synced}</>
          ) : (
            <>Not synced yet</>
          )}
        </p>
        <div className="programme-bar-actions">
          <a className="kit-btn" href={SHEET_URL} target="_blank" rel="noreferrer">
            <ExternalLink size={15} aria-hidden="true" />
            Sheet
          </a>
          <button type="button" className="kit-btn" onClick={syncNow} disabled={busy === "sync"}>
            <RefreshCw size={15} aria-hidden="true" className={busy === "sync" ? "spin" : undefined} />
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      <div className="programme-filters" role="group" aria-label="Show">
        <button type="button" className={scope === "upcoming" ? "active" : undefined} onClick={() => setScope("upcoming")}>
          Upcoming
        </button>
        <button type="button" className={scope === "all" ? "active" : undefined} onClick={() => setScope("all")}>
          Whole year
        </button>
        <label className="programme-check">
          <input type="checkbox" checked={walksOnly} onChange={(e) => setWalksOnly(e.target.checked)} />
          Walks only
        </label>
      </div>

      {conflicted ? (
        <p className="programme-conflict-note">
          <AlertTriangle size={15} aria-hidden="true" />
          {conflicted === 1 ? "1 row was" : `${conflicted} rows were`} changed in the sheet and here at the same time. Open it to choose which
          to keep.
        </p>
      ) : null}
      {error ? <p className="kit-form-error">{error}</p> : null}

      {months.length ? (
        months.map(({ month, walks: rows }) => (
          <section key={month}>
            <h2 className="events-month">{month}</h2>
            <ul className="programme-list">
              {rows.map((w) => (
                <li key={w.id} className={`${w.published ? "" : "is-unpublished"}${w.conflicts.length ? " has-conflict" : ""}`}>
                  <div className="event-date">
                    <span>{w.weekday}</span>
                    <strong>{w.day}</strong>
                  </div>
                  <div className="programme-body">
                    <h3>
                      {w.title}
                      {w.conflicts.length ? <span className="event-status is-warning">{w.conflicts.length} to resolve</span> : null}
                    </h3>
                    <p className="event-meta">
                      {w.status || "No status"}
                      {" · "}
                      {w.eventId ? (
                        <a href={`/portal/events/${w.eventId}`}>On SU{w.linkAuto ? "" : " (set by hand)"}</a>
                      ) : (
                        "Not on SU yet"
                      )}
                    </p>
                    <div className="programme-controls">
                      <label className="programme-switch">
                        <input
                          type="checkbox"
                          checked={w.published}
                          disabled={busy === w.id}
                          onChange={(e) => patch(w.id, { published: e.target.checked })}
                        />
                        <span>{w.published ? "Published" : "Hidden"}</span>
                      </label>
                      <select
                        aria-label={`Who can see ${w.title}`}
                        value={w.visibilityFromSheet ? "sheet" : w.visibility}
                        disabled={busy === w.id}
                        onChange={(e) => patch(w.id, { visibility: e.target.value })}
                      >
                        <option value="sheet">{VISIBILITY_LABELS[w.sheetVisibility]} · sheet</option>
                        {VISIBILITY.map((v) => (
                          <option key={v} value={v}>
                            {VISIBILITY_LABELS[v]}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="kit-btn programme-edit" onClick={() => setEditing(w)} aria-label={`Edit ${w.title}`} title="Edit">
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p className="day-note">Nothing on the calendar {scope === "upcoming" ? "from today" : "this year"}.</p>
      )}

      {editing ? (
        <WalkEditor
          walk={walks.find((w) => w.id === editing.id) ?? editing}
          events={events}
          busy={busy === `edit:${editing.id}`}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            const result = await patch(editing.id, body, `edit:${editing.id}`);
            if (result && !result.conflicts?.length) setEditing(null);
            return result;
          }}
        />
      ) : null}
    </>
  );
}

function fieldsFor(walk: ProgrammeWalk): FieldDef[] {
  return FIELDS.filter((f) => (walk.hasPlanning ? !f.eventOnly : !f.walkOnly));
}

function WalkEditor({
  walk,
  events,
  busy,
  onClose,
  onSave,
}: {
  walk: ProgrammeWalk;
  events: ProgrammeEvent[];
  busy: boolean;
  onClose: () => void;
  onSave: (body: unknown) => Promise<{ conflicts?: string[] } | null>;
}) {
  const fields = fieldsFor(walk);
  const [draft, setDraft] = useState<Values>(() => Object.fromEntries(fields.map((f) => [f.key, walk.values[f.key] ?? ""])));
  const [link, setLink] = useState(walk.linkAuto ? "auto" : walk.eventSuuId ?? "");
  const [note, setNote] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const edits: Values = {};
    const from: Values = {};
    for (const f of fields) {
      const before = walk.values[f.key] ?? "";
      if ((draft[f.key] ?? "") !== before) {
        edits[f.key] = draft[f.key] ?? "";
        from[f.key] = before;
      }
    }
    const body: Record<string, unknown> = {};
    if (Object.keys(edits).length) Object.assign(body, { edits, from });
    const currentLink = walk.linkAuto ? "auto" : walk.eventSuuId ?? "";
    if (link !== currentLink) body.eventSuuId = link === "" ? null : link;
    if (!Object.keys(body).length) return onClose();
    const result = await onSave(body);
    if (result?.conflicts?.length) setNote("Someone changed that in the sheet since you opened it. Choose which to keep below.");
  }

  const groups: { title: string; fields: FieldDef[] }[] = [
    { title: "Event", fields: fields.filter((f) => f.home === "main") },
    { title: "Route and travel", fields: fields.filter((f) => f.home === "planning") },
    { title: "Walk leaders", fields: fields.filter((f) => f.home === "signups") },
  ].filter((g) => g.fields.length);

  return (
    <Sheet onClose={onClose} labelledBy="walk-sheet-title">
      <h3 id="walk-sheet-title">{walk.title}</h3>
      <p>Saving writes to the committee calendar. Columns the sheet works out for itself (status, meeting time, totals) aren&apos;t here.</p>

      {walk.conflicts.length ? (
        <div className="programme-conflicts">
          <p className="event-eyebrow">Changed in both places</p>
          {walk.conflicts.map((c) => (
            <ConflictRow key={c.field} walkId={walk.id} conflict={c} onSave={onSave} />
          ))}
        </div>
      ) : null}

      <form className="kit-form" onSubmit={save}>
        <label className="kit-field">
          <span>SU event</span>
          <select value={link} onChange={(e) => setLink(e.target.value)}>
            <option value="auto">Match automatically (date and name)</option>
            <option value="">Not on SU</option>
            {events.map((ev) => (
              <option key={ev.suuId} value={ev.suuId}>
                {ev.label}
              </option>
            ))}
          </select>
        </label>
        {groups.map((g) => (
          <fieldset key={g.title} className="programme-fields">
            <legend className="event-eyebrow">{g.title}</legend>
            {g.fields.map((f) => (
              <label key={f.key} className="kit-field">
                <span>{f.label}</span>
                {f.kind === "long" ? (
                  <textarea rows={4} value={draft[f.key] ?? ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
                ) : (
                  <input
                    type={f.kind === "url" ? "url" : "text"}
                    inputMode={f.kind === "number" ? "decimal" : f.kind === "url" ? "url" : undefined}
                    placeholder={f.kind === "date" ? "dd/mm/yyyy" : f.home === "signups" ? "Name, (+) if first aid trained" : undefined}
                    value={draft[f.key] ?? ""}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  />
                )}
              </label>
            ))}
          </fieldset>
        ))}
        {note ? <p className="kit-form-error">{note}</p> : null}
        <div className="modal-actions">
          <button type="button" className="kit-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="kit-btn primary" disabled={busy}>
            {busy ? "Saving…" : "Save to sheet"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function ConflictRow({
  walkId,
  conflict,
  onSave,
}: {
  walkId: string;
  conflict: ProgrammeWalk["conflicts"][number];
  onSave: (body: unknown) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const keep = async (which: "sheet" | "app") => {
    setBusy(true);
    await onSave({ resolve: { field: conflict.field, keep: which } });
    setBusy(false);
  };
  return (
    <div className="programme-conflict" data-walk={walkId}>
      <strong>{conflict.label}</strong>
      <div className="programme-conflict-options">
        <button type="button" className="kit-btn" disabled={busy} onClick={() => keep("sheet")}>
          <span className="event-eyebrow">Sheet</span>
          <span>{conflict.sheet || "(empty)"}</span>
        </button>
        <button type="button" className="kit-btn" disabled={busy} onClick={() => keep("app")}>
          <span className="event-eyebrow">App{conflict.by ? ` · ${conflict.by}` : ""}</span>
          <span>{conflict.app || "(empty)"}</span>
        </button>
      </div>
    </div>
  );
}
