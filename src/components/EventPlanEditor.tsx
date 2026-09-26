"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import type { EventPlanView, PlanPerson } from "@/lib/eventPlans";

interface Draft {
  leader_member_id: string;
  backmarker_member_id: string;
  meet_at: string;
  meet_point: string;
  transport: string;
  kit_list: string;
  route_url: string;
  booking_url: string;
  notes: string;
}

/** `datetime-local` wants London wall-clock time without a zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** And back: find the UTC instant whose London time is the one typed. */
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const guess = new Date(`${value}:00Z`);
  const shown = toLocalInput(guess.toISOString());
  const drift = new Date(`${shown}:00Z`).getTime() - guess.getTime();
  return new Date(guess.getTime() - drift).toISOString();
}

function draftOf(plan: EventPlanView | null, fallbackMeetAt: string | null): Draft {
  return {
    leader_member_id: plan?.leader_member_id ?? "",
    backmarker_member_id: plan?.backmarker_member_id ?? "",
    meet_at: toLocalInput(plan?.meet_at ?? fallbackMeetAt),
    meet_point: plan?.meet_point ?? "",
    transport: plan?.transport ?? "",
    kit_list: (plan?.kit_list ?? []).join("\n"),
    route_url: plan?.route_url ?? "",
    booking_url: plan?.booking_url ?? "",
    notes: plan?.notes ?? "",
  };
}

export function EventPlanEditor({ eventId, startsAt }: { eventId: string; startsAt: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [leaders, setLeaders] = useState<PlanPerson[]>([]);
  const [canAssign, setCanAssign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setOpen(true);
    setError(null);
    setDraft(null);
    try {
      const res = await fetch(`/api/events/${eventId}/plan`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "The plan didn't load.");
      setLeaders(body.leaders ?? []);
      setCanAssign(Boolean(body.canAssign));
      setDraft(draftOf(body.plan, startsAt));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The plan didn't load.");
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          meet_at: fromLocalInput(draft.meet_at),
          leader_member_id: draft.leader_member_id || null,
          backmarker_member_id: draft.backmarker_member_id || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "The plan wasn't saved.");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The plan wasn't saved.");
    } finally {
      setBusy(false);
    }
  }

  const set = (field: keyof Draft) => (e: { target: { value: string } }) =>
    setDraft((d) => (d ? { ...d, [field]: e.target.value } : d));

  return (
    <>
      <button type="button" className="kit-btn" onClick={start}>
        <Pencil size={15} aria-hidden="true" />
        Edit plan
      </button>
      {open ? (
        <Sheet onClose={() => setOpen(false)} labelledBy="plan-sheet">
          <h3 id="plan-sheet">Walk plan</h3>
          <p>Members see this on the event page. It overrides what the post says.</p>
          {!draft ? (
            error ? <p className="kit-form-error">{error}</p> : <div className="skeleton" style={{ height: 180 }} />
          ) : (
            <form className="kit-form" onSubmit={save}>
              {canAssign ? (
                <div className="kit-form-row">
                  <Field label="Leader">
                    <select value={draft.leader_member_id} onChange={set("leader_member_id")}>
                      <option value="">Not set</option>
                      {leaders.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name ?? "Unnamed"}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Backmarker">
                    <select value={draft.backmarker_member_id} onChange={set("backmarker_member_id")}>
                      <option value="">Not set</option>
                      {leaders.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name ?? "Unnamed"}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              ) : null}
              <div className="kit-form-row">
                <Field label="Meet at">
                  <input type="datetime-local" value={draft.meet_at} onChange={set("meet_at")} />
                </Field>
                <Field label="Meeting point">
                  <input value={draft.meet_point} onChange={set("meet_point")} placeholder="Euston, by the departures board" maxLength={200} />
                </Field>
              </div>
              <Field label="Transport">
                <input value={draft.transport} onChange={set("transport")} placeholder="10:04 train to Tring, off-peak return £14.60" maxLength={500} />
              </Field>
              <Field label="Kit list, one per line">
                <textarea rows={5} value={draft.kit_list} onChange={set("kit_list")} placeholder={"Waterproof jacket\nWalking boots\nLunch and 1.5 L water"} />
              </Field>
              <Field label="Route link (OS Maps, Komoot, GPX)">
                <input type="url" inputMode="url" value={draft.route_url} onChange={set("route_url")} placeholder="https://" />
              </Field>
              <Field label="Booking link (SU ticket page)">
                <input type="url" inputMode="url" value={draft.booking_url} onChange={set("booking_url")} placeholder="https://studentsunionucl.org/…" />
              </Field>
              <Field label="Notes">
                <textarea rows={3} value={draft.notes} onChange={set("notes")} maxLength={2000} />
              </Field>
              {error ? <p className="kit-form-error">{error}</p> : null}
              <div className="modal-actions">
                <button type="button" className="kit-btn" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="kit-btn primary" disabled={busy}>
                  {busy ? "Saving…" : "Save plan"}
                </button>
              </div>
            </form>
          )}
        </Sheet>
      ) : null}
    </>
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
