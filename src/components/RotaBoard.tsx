"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { AVAILABILITY, AVAILABILITY_LABELS, type Availability } from "@/lib/rota";

export interface RotaWalk {
  id: string;
  suuId: string;
  name: string;
  when: string;
  weekday: string;
  day: string;
  month: string;
  leaderId: string | null;
  leaderName: string | null;
  backmarkerId: string | null;
  backmarkerName: string | null;
  mine: Availability | null;
  offers: { memberId: string; name: string; status: Availability }[];
}

export interface RotaPerson {
  id: string;
  name: string;
}

/**
 * Upcoming walks by month, like the programme: tap one to say whether you
 * can lead it, see who else has, and (committee) pick its leader and
 * backmarker.
 */
export function RotaBoard({ walks, people, canAssign }: { walks: RotaWalk[]; people: RotaPerson[]; canAssign: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // By id, so the open sheet shows the refreshed walk after each save.
  const [openId, setOpenId] = useState<string | null>(null);
  const open = walks.find((w) => w.suuId === openId) ?? null;

  const months = useMemo(() => {
    const out: { month: string; walks: RotaWalk[] }[] = [];
    for (const w of walks) {
      const last = out.at(-1);
      if (last && last.month === w.month) last.walks.push(w);
      else out.push({ month: w.month, walks: [w] });
    }
    return out;
  }, [walks]);

  async function send(key: string, url: string, method: string, body: unknown) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "That wasn't saved.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That wasn't saved.");
    } finally {
      setBusy(null);
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
              const offered = walk.offers.filter((o) => o.status !== "unavailable").length;
              return (
                <li key={walk.suuId} className={walk.leaderId ? undefined : "needs-leader"}>
                  <button type="button" className="rota-row" onClick={() => (setError(null), setOpenId(walk.suuId))}>
                    <span className="event-date">
                      <span>{walk.weekday}</span>
                      <strong>{walk.day}</strong>
                    </span>
                    <span className="programme-body">
                      <span className="rota-title">
                        {walk.name}
                        {!walk.leaderId ? <span className="event-status">Needs a leader</span> : null}
                      </span>
                      <span className="event-meta">
                        {walk.leaderName ? `Led by ${walk.leaderName}` : "No leader yet"}
                        {walk.backmarkerName ? ` · backmarker ${walk.backmarkerName}` : ""}
                        {offered ? ` · ${offered} offered` : ""}
                      </span>
                      {walk.mine ? <span className={`rota-mine-tag is-${walk.mine}`}>You: {AVAILABILITY_LABELS[walk.mine]}</span> : null}
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
        <RotaSheet walk={open} people={people} canAssign={canAssign} busy={busy} error={error} send={send} onClose={() => setOpenId(null)} />
      ) : null}
    </>
  );
}

function RotaSheet({
  walk,
  people,
  canAssign,
  busy,
  error,
  send,
  onClose,
}: {
  walk: RotaWalk;
  people: RotaPerson[];
  canAssign: boolean;
  busy: string | null;
  error: string | null;
  send: (key: string, url: string, method: string, body: unknown) => Promise<void>;
  onClose: () => void;
}) {
  const offered = walk.offers.filter((o) => o.status !== "unavailable");
  const offeredIds = new Set(offered.map((o) => o.memberId));
  const options = [...offered.map((o) => ({ id: o.memberId, name: `${o.name} · ${AVAILABILITY_LABELS[o.status]}` })), ...people.filter((p) => !offeredIds.has(p.id))];

  return (
    <Sheet onClose={onClose} labelledBy="rota-sheet-title">
      <h3 id="rota-sheet-title">{walk.name}</h3>
      <p>
        {walk.when} · <Link href={`/portal/events/${walk.id}`}>Walk details</Link>
      </p>

      <section className="rota-sheet-section">
        <p className="event-eyebrow">Leading</p>
        <p className="rota-who">
          {walk.leaderName ? `Led by ${walk.leaderName}` : "No leader yet"}
          {walk.backmarkerName ? ` · backmarker ${walk.backmarkerName}` : ""}
        </p>
        {offered.length ? (
          <ul className="rota-offers">
            {offered.map((o) => (
              <li key={o.memberId}>
                <span>{o.name}</span>
                <span className={`rota-mine-tag is-${o.status}`}>{AVAILABILITY_LABELS[o.status]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="day-note">Nobody has offered yet.</p>
        )}
      </section>

      {canAssign ? (
        <section className="rota-sheet-section">
          <p className="event-eyebrow">Pick</p>
          <div className="kit-form-row rota-assign">
            {(["leader", "backmarker"] as const).map((role) => {
              const field = role === "leader" ? "leader_member_id" : "backmarker_member_id";
              const value = role === "leader" ? walk.leaderId : walk.backmarkerId;
              return (
                <label key={role} className="kit-field">
                  <span>{role === "leader" ? "Leader" : "Backmarker"}</span>
                  <select
                    value={value ?? ""}
                    disabled={busy === `${walk.suuId}:${role}`}
                    onChange={(e) => send(`${walk.suuId}:${role}`, `/api/events/${walk.id}/plan`, "PATCH", { [field]: e.target.value || null })}
                  >
                    <option value="">Not set</option>
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="rota-sheet-section">
        <p className="event-eyebrow">Can you lead it?</p>
        <div className="rota-mine" role="group" aria-label={`Your availability for ${walk.name}`}>
          {AVAILABILITY.map((status) => (
            <button
              key={status}
              type="button"
              className={walk.mine === status ? "active" : undefined}
              aria-pressed={walk.mine === status}
              disabled={busy === walk.suuId}
              onClick={() => send(walk.suuId, "/api/rota", "PUT", { event_suu_id: walk.suuId, status: walk.mine === status ? null : status })}
            >
              {AVAILABILITY_LABELS[status]}
            </button>
          ))}
        </div>
        {walk.mine ? <p className="day-note">Tap your answer again to take your name off.</p> : null}
      </section>

      {error ? <p className="kit-form-error">{error}</p> : null}
      <div className="modal-actions">
        <button type="button" className="kit-btn" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
