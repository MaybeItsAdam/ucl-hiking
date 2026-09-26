"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Backpack,
  Check,
  CloudOff,
  HeartPulse,
  Phone,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { headcount, type AttendanceOp, type Attendee } from "@/lib/attendees";
import {
  applyOps,
  expiryFor,
  outboxKey,
  purgeExpired,
  read,
  snapshotKey,
  write,
  type DaySnapshot,
} from "@/lib/dayOffline";
import { INCIDENT_KINDS, INCIDENT_LABELS, type IncidentKind } from "@/lib/incidents";

const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

interface Found {
  id: string;
  full_name: string | null;
}

/**
 * The leader's register for the day. Loaded once with signal, it keeps working
 * offline: taps land in a local queue that is sent when the phone reconnects.
 */
export default function WalkDay({ eventId }: { eventId: string }) {
  const [snapshot, setSnapshot] = useState<DaySnapshot | null>(() => {
    purgeExpired(localStorage);
    return read<DaySnapshot>(localStorage, snapshotKey(eventId));
  });
  const [outbox, setOutbox] = useState<AttendanceOp[]>(() => read<AttendanceOp[]>(localStorage, outboxKey(eventId)) ?? []);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [person, setPerson] = useState<Attendee | null>(null);
  const [adding, setAdding] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [confirmAllBack, setConfirmAllBack] = useState(false);
  const [tally, setTally] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const flushing = useRef(false);

  const keep = useCallback(
    (next: DaySnapshot) => {
      setSnapshot(next);
      write(localStorage, snapshotKey(eventId), next, expiryFor(next.event));
    },
    [eventId],
  );

  // The queue is kept as long as the register it belongs to.
  const eventTimes = snapshot?.event;
  const queue = useCallback(
    (next: AttendanceOp[]) => {
      setOutbox(next);
      write(localStorage, outboxKey(eventId), next, expiryFor(eventTimes ?? { starts_at: null, ends_at: null }));
    },
    [eventId, eventTimes],
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/day`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "The register didn't load.");
      keep(body as DaySnapshot);
      setError(null);
    } catch (e) {
      // Offline with a stored register is the normal case on a hill; say nothing.
      if (navigator.onLine) setError(e instanceof Error ? e.message : "The register didn't load.");
    }
  }, [eventId, keep]);

  /** Send queued taps. The server applies each person's last tap, so resending is harmless. */
  const flush = useCallback(async () => {
    const pending = read<AttendanceOp[]>(localStorage, outboxKey(eventId)) ?? [];
    if (!pending.length || flushing.current || !navigator.onLine) return;
    flushing.current = true;
    try {
      const res = await fetch(`/api/events/${eventId}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ops: pending }),
      });
      if (!res.ok) return;
      // Keep anything tapped while the request was in flight.
      const now = read<AttendanceOp[]>(localStorage, outboxKey(eventId)) ?? [];
      queue(now.slice(pending.length));
      await load();
    } catch {
      // Still offline; the queue waits.
    } finally {
      flushing.current = false;
    }
  }, [eventId, load, queue]);

  useEffect(() => {
    const t = setTimeout(() => void flush().then(load), 0);
    const up = () => {
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      clearTimeout(t);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [flush, load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const attendees = useMemo(
    () => (snapshot ? applyOps(snapshot.attendees, outbox).filter((a) => !a.removed) : []),
    [snapshot, outbox],
  );
  const count = headcount(attendees);
  const missing = attendees.filter((a) => !a.checked_in_at);

  function tap(op: AttendanceOp) {
    queue([...outbox, op]);
    void flush();
  }

  function toggle(a: Attendee) {
    const at = new Date().toISOString();
    tap(a.checked_in_at ? { kind: "undo_check_in", attendeeId: a.id, at } : { kind: "check_in", attendeeId: a.id, at });
  }

  async function send(url: string, init: RequestInit, failure: string): Promise<boolean> {
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? failure);
      if (body.attendees && snapshot) keep({ ...snapshot, attendees: body.attendees });
      return true;
    } catch (e) {
      setToast(navigator.onLine ? (e instanceof Error ? e.message : failure) : "You're offline. Try again with signal.");
      return false;
    }
  }

  async function refreshFromToolbox() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/events/${eventId}/day`, { method: "POST" });
      const body = await res.json();
      if (body.status === "unavailable") setToast("Toolbox can't share ticket holders yet. Add people by hand.");
      else if (body.status === "error") setToast(body.reason ?? "Toolbox didn't answer.");
      else setToast(body.inserted ? `${body.inserted} new ticket holder${body.inserted === 1 ? "" : "s"} added.` : "The list is up to date.");
      await load();
    } catch {
      setToast("You're offline. Try again with signal.");
    } finally {
      setRefreshing(false);
    }
  }

  if (!snapshot) {
    return error ? (
      <p className="day-error">{error}</p>
    ) : (
      <div className="skeleton-list" aria-label="Loading the register">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    );
  }

  const allBack = count.checkedIn > 0 && count.returned === count.checkedIn;

  return (
    <div className="day-page">
      <div className={`day-status${online ? "" : " is-offline"}`} role="status">
        {online ? <ShieldCheck size={15} aria-hidden="true" /> : <CloudOff size={15} aria-hidden="true" />}
        <span>
          {online ? "Saved for offline" : "Offline"} · register from {clock.format(new Date(snapshot.fetchedAt))}
          {outbox.length ? ` · ${outbox.length} change${outbox.length === 1 ? "" : "s"} waiting to send` : ""}
        </span>
      </div>

      <div className="day-count" aria-live="polite">
        <div>
          <span className="day-count-label">Checked in</span>
          <strong>
            {count.checkedIn}
            <small> / {count.expected}</small>
          </strong>
        </div>
        <div className={count.missing ? "is-warn" : undefined}>
          <span className="day-count-label">Missing</span>
          <strong>{count.missing}</strong>
        </div>
        <div className={allBack ? "is-ok" : undefined}>
          <span className="day-count-label">Back safe</span>
          <strong>{count.returned}</strong>
        </div>
      </div>

      <div className="day-actions">
        {tally === null ? (
          <button type="button" className="kit-btn" onClick={() => setTally(0)} disabled={!count.checkedIn}>
            Count again
          </button>
        ) : (
          <div className="day-tally">
            <button type="button" className="kit-btn primary day-tally-tap" onClick={() => setTally((n) => (n ?? 0) + 1)}>
              <Plus size={18} aria-hidden="true" /> {tally}
            </button>
            <span className={tally === count.checkedIn ? "is-ok" : undefined}>
              {tally === count.checkedIn ? "Everyone here" : `of ${count.checkedIn}`}
            </span>
            <button type="button" className="kit-btn" onClick={() => setTally(null)}>
              Done
            </button>
          </div>
        )}
        <button
          type="button"
          className="kit-btn primary"
          onClick={() => setConfirmAllBack(true)}
          disabled={!count.checkedIn || allBack}
        >
          <Check size={15} aria-hidden="true" />
          {allBack ? "All back safe" : "Mark all back safe"}
        </button>
      </div>

      {snapshot.role === "committee" ? (
        <p className="day-note">
          Emergency details show only to this walk&apos;s leader and backmarker. Assign them on the event&apos;s plan.
        </p>
      ) : null}

      <section className="day-section" aria-labelledby="day-register">
        <div className="day-section-head">
          <h3 id="day-register" className="event-section-title">
            Register
          </h3>
          <button type="button" className="kit-btn" onClick={refreshFromToolbox} disabled={refreshing || !online}>
            <RefreshCw size={14} aria-hidden="true" />
            {refreshing ? "Checking…" : "Ticket holders"}
          </button>
          <button type="button" className="kit-btn" onClick={() => setAdding(true)} disabled={!online}>
            <UserPlus size={14} aria-hidden="true" />
            Add
          </button>
        </div>
        {attendees.length ? (
          <ul className="day-register">
            {attendees.map((a) => {
              const safety = snapshot.safety[a.id];
              return (
                <li key={a.id} className={a.checked_in_at ? "is-in" : undefined}>
                  <button
                    type="button"
                    className="day-check"
                    aria-pressed={Boolean(a.checked_in_at)}
                    aria-label={`${a.checked_in_at ? "Undo check-in for" : "Check in"} ${a.name}`}
                    onClick={() => toggle(a)}
                  >
                    {a.checked_in_at ? <Check size={18} aria-hidden="true" /> : null}
                  </button>
                  <button type="button" className="day-person" onClick={() => setPerson(a)}>
                    <span className="day-person-name">{a.name}</span>
                    <span className="day-person-meta">
                      {a.checked_in_at ? `In ${clock.format(new Date(a.checked_in_at))}` : "Not here yet"}
                      {a.source === "leader" ? " · added on the day" : ""}
                    </span>
                  </button>
                  {safety?.medical_notes ? <HeartPulse className="day-flag" size={16} aria-label="Has medical notes" /> : null}
                  {safety?.contact_phone ? (
                    <a className="kit-icon-btn" href={`tel:${safety.contact_phone.replace(/\s/g, "")}`} aria-label={`Call ${a.name}'s emergency contact`}>
                      <Phone size={16} aria-hidden="true" />
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="day-note">
            Nobody on the register yet. Pull ticket holders from Toolbox, or add people as they arrive.
          </p>
        )}
        {missing.length && count.checkedIn ? (
          <p className="day-note">Not checked in: {missing.map((a) => a.name).join(", ")}.</p>
        ) : null}
      </section>

      {snapshot.kit.length ? (
        <section className="day-section" aria-labelledby="day-kit">
          <h3 id="day-kit" className="event-section-title">
            Club kit for this walk
          </h3>
          <ul className="day-kit">
            {snapshot.kit.map((k) => (
              <li key={k.id}>
                <Backpack size={15} aria-hidden="true" />
                <span>
                  {k.quantity > 1 ? `${k.quantity} × ` : ""}
                  {k.name}
                </span>
                <small>{k.status === "pending" ? "Awaiting approval" : k.borrower ? `With ${k.borrower}` : "On loan"}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="day-section">
        <button type="button" className="kit-btn danger" onClick={() => setReporting(true)}>
          <AlertTriangle size={15} aria-hidden="true" />
          Report an incident
        </button>
        <p className="day-note">
          In an emergency call 999 and ask for Police, then Mountain Rescue. Open this page once with signal before
          you set off so the register works offline.
        </p>
      </section>

      {person ? (
        <PersonSheet
          attendee={person}
          safety={snapshot.safety[person.id]}
          online={online}
          onClose={() => setPerson(null)}
          onRemove={async () => {
            if (await send(`/api/events/${eventId}/attendees?attendee=${person.id}`, { method: "DELETE" }, "They weren't removed.")) {
              setPerson(null);
            }
          }}
        />
      ) : null}

      {adding ? (
        <AddSheet
          onClose={() => setAdding(false)}
          onAdd={async (payload) => {
            if (await send(`/api/events/${eventId}/attendees`, { method: "POST", body: JSON.stringify(payload) }, "They weren't added.")) {
              setToast("Added to the register.");
              return true;
            }
            return false;
          }}
        />
      ) : null}

      {reporting ? (
        <IncidentSheet
          eventSuuId={snapshot.event.suu_event_id}
          onClose={() => setReporting(false)}
          onSent={() => {
            setReporting(false);
            setToast("Report sent to the principals.");
          }}
        />
      ) : null}

      {confirmAllBack ? (
        <Sheet onClose={() => setConfirmAllBack(false)} labelledBy="all-back-sheet">
          <h3 id="all-back-sheet">Everyone back safe?</h3>
          <p>
            Marks all {count.checkedIn} people who checked in as back.
            {count.missing ? ` ${count.missing} on the register never checked in.` : ""}
          </p>
          <div className="modal-actions">
            <button type="button" className="kit-btn" onClick={() => setConfirmAllBack(false)}>
              Not yet
            </button>
            <button
              type="button"
              className="kit-btn primary"
              onClick={() => {
                tap({ kind: "all_back", at: new Date().toISOString() });
                setConfirmAllBack(false);
                setToast("Everyone's marked back safe.");
              }}
            >
              All back safe
            </button>
          </div>
        </Sheet>
      ) : null}

      {toast ? (
        <div className="kit-toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function PersonSheet({
  attendee,
  safety,
  online,
  onClose,
  onRemove,
}: {
  attendee: Attendee;
  safety: DaySnapshot["safety"][string] | undefined;
  online: boolean;
  onClose: () => void;
  onRemove: () => void;
}) {
  const tel = (n: string) => `tel:${n.replace(/\s/g, "")}`;
  return (
    <Sheet onClose={onClose} labelledBy="person-sheet">
      <h3 id="person-sheet">{attendee.name}</h3>
      {safety ? (
        <dl className="member-facts">
          {safety.phone ? (
            <div>
              <dt>Their phone</dt>
              <dd>
                <a href={tel(safety.phone)}>{safety.phone}</a>
              </dd>
            </div>
          ) : null}
          {safety.contact_phone ? (
            <div>
              <dt>Emergency contact</dt>
              <dd>
                {safety.contact_name ?? "Contact"}
                {safety.contact_relation ? ` (${safety.contact_relation})` : ""} ·{" "}
                <a href={tel(safety.contact_phone)}>{safety.contact_phone}</a>
              </dd>
            </div>
          ) : null}
          {safety.medical_notes ? (
            <div className="day-medical">
              <dt>Medical</dt>
              <dd>{safety.medical_notes}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p>{attendee.member_id ? "They haven't added emergency details, or you can't see them for this walk." : "Added by name, so there are no details on file."}</p>
      )}
      <div className="modal-actions">
        <button type="button" className="kit-btn danger-text" onClick={onRemove} disabled={!online}>
          <Trash2 size={14} aria-hidden="true" />
          Remove from register
        </button>
        <button type="button" className="kit-btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

function AddSheet({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (payload: { member_id: string } | { name: string }) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/members/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((body) => setFound(body.members ?? []))
        .catch(() => undefined);
    }, 200);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query]);

  async function add(payload: { member_id: string } | { name: string }) {
    setBusy(true);
    if (await onAdd(payload)) {
      setQuery("");
      setFound([]);
    }
    setBusy(false);
  }

  const shown = query.trim().length >= 2 ? found : [];

  return (
    <Sheet onClose={onClose} labelledBy="add-sheet">
      <h3 id="add-sheet">Add to the register</h3>
      <p>Search the roster, or add a name for someone not on it.</p>
      <form
        className="kit-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (query.trim()) void add({ name: query.trim() });
        }}
      >
        <Field label="Name">
          <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus placeholder="Start typing a name" maxLength={100} />
        </Field>
        {shown.length ? (
          <ul className="day-found">
            {shown.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => add({ member_id: m.id })} disabled={busy}>
                  {m.full_name ?? "Unnamed member"}
                  <Plus size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="kit-btn" onClick={onClose}>
            Done
          </button>
          <button type="submit" className="kit-btn primary" disabled={busy || !query.trim()}>
            Add “{query.trim() || "name"}” as a guest
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function IncidentSheet({ eventSuuId, onClose, onSent }: { eventSuuId: string; onClose: () => void; onSent: () => void }) {
  const [kind, setKind] = useState<IncidentKind>("injury");
  const [description, setDescription] = useState("");
  const [actions, setActions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_suu_id: eventSuuId, kind, description, actions_taken: actions, occurred_at: new Date().toISOString() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "The report wasn't sent.");
      onSent();
    } catch (err) {
      setError(navigator.onLine ? (err instanceof Error ? err.message : "The report wasn't sent.") : "You're offline. Write it down and send it with signal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={onClose} labelledBy="incident-sheet">
      <h3 id="incident-sheet">Report an incident</h3>
      <p>Only the principals see reports. Write what happened while it&apos;s fresh; you can add more later.</p>
      <form className="kit-form" onSubmit={submit}>
        <Field label="What kind">
          <select value={kind} onChange={(e) => setKind(e.target.value as IncidentKind)}>
            {INCIDENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {INCIDENT_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What happened">
          <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={4000} />
        </Field>
        <Field label="What you did">
          <textarea rows={3} value={actions} onChange={(e) => setActions(e.target.value)} maxLength={4000} />
        </Field>
        {error ? <p className="kit-form-error">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="kit-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="kit-btn primary" disabled={busy || !description.trim()}>
            {busy ? "Sending…" : "Send report"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="kit-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
