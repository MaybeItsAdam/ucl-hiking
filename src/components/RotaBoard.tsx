"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { ROTA_FIELDS, ROTA_LABELS, ROTA_LISTS, ROTA_SLOTS, type RotaField } from "@/lib/rota";

export interface RotaWalk {
  /** Stable React key: the sheet walk's id, or `su:<id>` for an SU walk the WL calendar lacks. */
  key: string;
  /** sheet_walks id; null when the WL calendar has no row for it. */
  walkId: string | null;
  /** The app's event id, for "Walk details". */
  eventId: string | null;
  name: string;
  when: string;
  weekday: string;
  day: string;
  month: string;
  /** False when the WL calendar has no sign-up row (or the cells are formulas). */
  editable: boolean;
  /** Each rota cell as the sheet has it. */
  values: Record<RotaField, string>;
  /** An app edit the sheet had moved on from, waiting for someone to pick. */
  conflicts: Partial<Record<RotaField, { sheet: string; app: string }>>;
  /** Changes whenever the walk is saved or re-read, so the form starts again from the sheet. */
  version: string;
  /** For the list: names in the six slots, and how many additional / shadowing. */
  leaders: string[];
  extra: number;
  shadowing: number;
}

/** A list cell ("A, B, C") as the text area shows it: one name a line. */
const asLines = (cell: string) =>
  cell
    .split(/,(?![^()]*\))/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n");

const isList = (field: RotaField) => (ROTA_LISTS as readonly string[]).includes(field);

/**
 * Upcoming walks by month, like the programme: tap one to fill in its walk
 * leaders. The slots are the WL calendar's cells, so it doesn't matter
 * whether a name goes in here or on the sheet.
 */
export function RotaBoard({ walks }: { walks: RotaWalk[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // By key, so the open sheet shows the refreshed walk after each save.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = walks.find((w) => w.key === openKey) ?? null;

  const months = useMemo(() => {
    const out: { month: string; walks: RotaWalk[] }[] = [];
    for (const w of walks) {
      const last = out.at(-1);
      if (last && last.month === w.month) last.walks.push(w);
      else out.push({ month: w.month, walks: [w] });
    }
    return out;
  }, [walks]);

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/rota", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "That wasn't saved.");
      setNotice(json.conflicts?.length ? "Someone changed the WL calendar while you were typing. Pick which to keep below." : done);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That wasn't saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!walks.length) return <p className="day-note">No walks in the next two months yet.</p>;

  return (
    <>
      {months.map(({ month, walks: rows }) => (
        <section key={month}>
          <h2 className="events-month">{month}</h2>
          <ul className="programme-list rota-rows">
            {rows.map((walk) => {
              const filled = walk.leaders.length;
              const extras = [walk.extra ? `+${walk.extra} additional` : "", walk.shadowing ? `${walk.shadowing} shadowing` : ""].filter(Boolean).join(" · ");
              return (
                <li key={walk.key} className={filled ? undefined : "needs-leader"}>
                  <button
                    type="button"
                    className="rota-row"
                    onClick={() => {
                      setError(null);
                      setNotice(null);
                      setOpenKey(walk.key);
                    }}
                  >
                    <span className="event-date">
                      <span>{walk.weekday}</span>
                      <strong>{walk.day}</strong>
                    </span>
                    <span className="programme-body">
                      <span className="rota-title">
                        {walk.name}
                        {!filled && walk.editable ? <span className="event-status">Needs leaders</span> : null}
                      </span>
                      <span className="event-meta">
                        {filled ? walk.leaders.join(", ") : walk.editable ? "No walk leaders yet" : "Not on the WL calendar yet"}
                        {extras ? ` · ${extras}` : ""}
                      </span>
                      {walk.editable ? (
                        <span className={`rota-fill-tag${filled >= ROTA_SLOTS.length ? " is-full" : ""}`}>
                          {filled}/{ROTA_SLOTS.length} WLs
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight size={18} aria-hidden="true" className="rota-chevron" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {open ? (
        <Sheet onClose={() => setOpenKey(null)} labelledBy="rota-sheet-title">
          <RotaForm key={`${open.key}:${open.version}`} walk={open} busy={busy} error={error} notice={notice} send={send} onClose={() => setOpenKey(null)} />
        </Sheet>
      ) : null}
    </>
  );
}

function RotaForm({
  walk,
  busy,
  error,
  notice,
  send,
  onClose,
}: {
  walk: RotaWalk;
  busy: boolean;
  error: string | null;
  notice: string | null;
  send: (body: Record<string, unknown>, done: string) => Promise<void>;
  onClose: () => void;
}) {
  // What the sheet said when the form opened: the text areas show lists one name a line.
  const initial = useMemo(
    () => Object.fromEntries(ROTA_FIELDS.map((k) => [k, isList(k) ? asLines(walk.values[k]) : walk.values[k]])) as Record<RotaField, string>,
    [walk],
  );
  const [draft, setDraft] = useState(initial);
  const changed = ROTA_FIELDS.filter((k) => draft[k].trim() !== initial[k].trim());
  const disabled = !walk.editable || busy;

  function save() {
    if (!walk.walkId || !changed.length) return;
    send(
      {
        walk_id: walk.walkId,
        edits: Object.fromEntries(changed.map((k) => [k, draft[k]])),
        from: Object.fromEntries(changed.map((k) => [k, walk.values[k]])),
      },
      "Saved to the WL calendar.",
    );
  }

  const field = (k: RotaField) => {
    const conflict = walk.conflicts[k];
    return (
      <div key={k} className="rota-field">
        <label className="kit-field">
          <span className="rota-label">{ROTA_LABELS[k]}</span>
          {isList(k) ? (
            <textarea
              rows={2}
              value={draft[k]}
              disabled={disabled}
              placeholder="One name a line"
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
            />
          ) : (
            <input
              type="text"
              value={draft[k]}
              disabled={disabled}
              autoComplete="off"
              autoCapitalize="words"
              enterKeyHint="done"
              placeholder="Name"
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
            />
          )}
        </label>
        {conflict && walk.walkId ? (
          <div className="rota-conflict" role="status">
            <p>
              The WL calendar says <strong>{conflict.sheet || "nothing"}</strong>; the app had <strong>{conflict.app || "nothing"}</strong>.
            </p>
            <div className="rota-conflict-actions">
              <button type="button" className="kit-btn" disabled={busy} onClick={() => send({ walk_id: walk.walkId, resolve: { field: k, keep: "sheet" } }, "Kept the WL calendar's.")}>
                Keep calendar
              </button>
              <button type="button" className="kit-btn" disabled={busy} onClick={() => send({ walk_id: walk.walkId, resolve: { field: k, keep: "app" } }, "Saved to the WL calendar.")}>
                Use app&apos;s
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <form
      className="rota-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <h3 id="rota-sheet-title">{walk.name}</h3>
      <p>
        {walk.when}
        {walk.eventId ? (
          <>
            {" · "}
            <Link href={`/portal/events/${walk.eventId}`}>Walk details</Link>
          </>
        ) : null}
      </p>
      {!walk.editable ? (
        <p className="day-note">
          {walk.walkId ? "This walk has no sign-up row on the WL calendar the app can write to, so fill it in on the sheet." : "This walk isn't on the WL calendar yet. Once it's added there, its slots show up here."}
        </p>
      ) : null}

      <section className="rota-sheet-section">
        <p className="event-eyebrow">Walk leaders</p>
        <div className="rota-slots">{ROTA_SLOTS.map(field)}</div>
      </section>
      <section className="rota-sheet-section">
        <div className="rota-lists">{ROTA_LISTS.map(field)}</div>
      </section>

      {error ? <p className="kit-form-error">{error}</p> : notice ? <p className="day-note">{notice}</p> : null}
      <div className="modal-actions">
        <button type="button" className="kit-btn" onClick={onClose}>
          {changed.length ? "Cancel" : "Done"}
        </button>
        {walk.editable ? (
          <button type="submit" className="kit-btn primary" disabled={busy || !changed.length}>
            {busy ? "Saving…" : "Save"}
          </button>
        ) : null}
      </div>
    </form>
  );
}
