"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AVAILABILITY, AVAILABILITY_LABELS, type Availability } from "@/lib/rota";

export interface RotaWalk {
  id: string;
  suuId: string;
  name: string;
  when: string;
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
 * Each upcoming walk: who leads it, and who has said they can. Leaders mark
 * themselves; committee assign from the people who offered.
 */
export function RotaBoard({ walks, people, canAssign }: { walks: RotaWalk[]; people: RotaPerson[]; canAssign: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      {error ? <p className="kit-form-error">{error}</p> : null}
      <ul className="rota-list">
        {walks.map((walk) => {
          const offered = walk.offers.filter((o) => o.status !== "unavailable");
          const offeredIds = new Set(offered.map((o) => o.memberId));
          const options = [...offered.map((o) => ({ id: o.memberId, name: `${o.name} · ${AVAILABILITY_LABELS[o.status]}` })), ...people.filter((p) => !offeredIds.has(p.id))];
          return (
            <li key={walk.suuId} className={walk.leaderId ? undefined : "needs-leader"}>
              <div className="rota-head">
                <Link href={`/portal/events/${walk.id}`}>
                  <strong>{walk.name}</strong>
                </Link>
                <span className="event-meta">{walk.when}</span>
                {!walk.leaderId ? <span className="event-status">Needs a leader</span> : null}
              </div>
              <div className="rota-mine" role="group" aria-label={`Your availability for ${walk.name}`}>
                {AVAILABILITY.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={walk.mine === status ? "active" : undefined}
                    aria-pressed={walk.mine === status}
                    disabled={busy === walk.suuId}
                    onClick={() =>
                      send(walk.suuId, "/api/rota", "PUT", { event_suu_id: walk.suuId, status: walk.mine === status ? null : status })
                    }
                  >
                    {AVAILABILITY_LABELS[status]}
                  </button>
                ))}
              </div>
              {canAssign ? (
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
                          onChange={(e) =>
                            send(`${walk.suuId}:${role}`, `/api/events/${walk.id}/plan`, "PATCH", { [field]: e.target.value || null })
                          }
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
              ) : (
                <p className="rota-who">
                  {walk.leaderName ? `Led by ${walk.leaderName}` : "No leader yet"}
                  {walk.backmarkerName ? ` · backmarker ${walk.backmarkerName}` : ""}
                  {offered.length ? ` · ${offered.length} offered` : ""}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
