"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Route, Upload } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { formatAscent, formatKm } from "@/lib/eventDetails";
import type { EventPlanView, PlanPerson } from "@/lib/eventPlans";
import type { RouteSummaryRow } from "@/lib/eventRoutes";

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
  const [route, setRoute] = useState<RouteSummaryRow | null>(null);
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
      setRoute(body.route ?? null);
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
      if (body.route) setRoute(body.route);
      router.refresh();
      // The plan saved but its route didn't come through: keep the sheet open to say why.
      if (body.routeError) {
        setError(`Plan saved. ${body.routeError}`);
        return;
      }
      setOpen(false);
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
              <Field label="OS Maps route link">
                <input
                  type="url"
                  inputMode="url"
                  value={draft.route_url}
                  onChange={set("route_url")}
                  placeholder="https://explore.osmaps.com/route/…"
                />
                <small className="kit-field-hint">
                  In the club&apos;s OS Maps, share the route as &ldquo;Anyone with link&rdquo; and paste it here. Saving draws it on the
                  map, and edits in OS Maps come through each morning.
                </small>
              </Field>
              <RouteAttach
                eventId={eventId}
                route={route}
                suggestedUrl={/\.gpx(?:$|[?#])/i.test(draft.route_url) ? draft.route_url : ""}
                onChange={(next) => {
                  setRoute(next);
                  router.refresh();
                }}
              />
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

/**
 * The GPX track drawn on the event page. Attaching or removing it saves at
 * once, apart from the plan form, since it is a file rather than a field.
 */
function RouteAttach({
  eventId,
  route,
  suggestedUrl,
  onChange,
}: {
  eventId: string;
  route: RouteSummaryRow | null;
  suggestedUrl: string;
  onChange: (route: RouteSummaryRow | null) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"upload" | "fetch" | "remove" | "pick" | null>(null);
  const [library, setLibrary] = useState<LibraryRoute[] | null>(null);
  const [picked, setPicked] = useState("");
  const [showFile, setShowFile] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/osmaps/routes")
      .then((res) => (res.ok ? res.json() : { routes: [] }))
      .then((body: { routes?: LibraryRoute[] }) => live && setLibrary(body.routes ?? []))
      .catch(() => live && setLibrary([]));
    return () => {
      live = false;
    };
  }, []);
  const [error, setError] = useState<string | null>(null);
  const shownUrl = url ?? suggestedUrl;

  async function send(kind: "upload" | "fetch" | "remove" | "pick", init: RequestInit) {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/gpx`, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "That didn't work.");
      onChange(kind === "remove" ? null : body.route);
      if (kind === "fetch") setUrl("");
      if (kind === "pick") setPicked("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    void send("upload", { method: "POST", body: form });
  }

  function fetchUrl() {
    if (!shownUrl.trim()) return;
    void send("fetch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: shownUrl.trim() }) });
  }

  function pick() {
    if (!picked) return;
    void send("pick", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ osmapsRouteId: picked }) });
  }

  const facts = route
    ? [
        route.source === "osmaps_auto" ? "matched from OS Maps" : route.osmaps_route_id ? "from OS Maps" : null,
        formatKm(route.distance_m / 1000),
        route.ascent_m !== null ? `${formatAscent(route.ascent_m)} up` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  const hasLibrary = Boolean(library?.length);

  return (
    <fieldset className="kit-field plan-gpx">
      <legend>GPX track, drawn on the map</legend>
      {route ? (
        <div className="plan-gpx-current">
          <Route size={16} aria-hidden="true" />
          <span>
            <strong>{route.name ?? route.source_file ?? "GPX route"}</strong>
            <small>{facts}</small>
          </span>
          <button
            type="button"
            className="kit-btn danger-text"
            disabled={busy !== null}
            onClick={() => void send("remove", { method: "DELETE" })}
          >
            {busy === "remove" ? "Removing…" : "Remove"}
          </button>
        </div>
      ) : (
        <p className="plan-gpx-hint">
          {hasLibrary
            ? "No route yet. Paste its OS Maps link above, or pick one the club has used before."
            : "No route yet. Paste its OS Maps link above, or upload a .gpx file."}
        </p>
      )}
      {hasLibrary ? (
        <div className="plan-gpx-url">
          <select value={picked} onChange={(e) => setPicked(e.target.value)} aria-label="Route from the club's OS Maps">
            <option value="">{route ? "Swap for a route used before…" : "Pick a route used before…"}</option>
            {library!.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {formatKm(r.distance_m / 1000)}
              </option>
            ))}
          </select>
          <button type="button" className="kit-btn" disabled={busy !== null || !picked} onClick={pick}>
            {busy === "pick" ? "Adding…" : "Use"}
          </button>
        </div>
      ) : null}
      {hasLibrary && !showFile ? (
        <button type="button" className="plan-gpx-more" onClick={() => setShowFile(true)}>
          Not in OS Maps? Upload a .gpx file
        </button>
      ) : (
      <div className="plan-gpx-controls">
        {/* No `accept`: iOS greys out every file for extensions it doesn't know, .gpx included. The server checks. */}
        <label className={`kit-btn${busy ? " is-disabled" : ""}`}>
          <Upload size={15} aria-hidden="true" />
          {busy === "upload" ? "Reading…" : route ? "Replace with a file" : "Upload .gpx"}
          <input type="file" className="sr-only" onChange={upload} disabled={busy !== null} />
        </label>
        <div className="plan-gpx-url">
          <input
            type="url"
            inputMode="url"
            value={shownUrl}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              fetchUrl();
            }}
            placeholder="https://…/route.gpx"
            aria-label="GPX link"
          />
          <button type="button" className="kit-btn" disabled={busy !== null || !shownUrl.trim()} onClick={fetchUrl}>
            {busy === "fetch" ? "Fetching…" : "Fetch"}
          </button>
        </div>
      </div>
      )}
      {error ? <p className="kit-form-error">{error}</p> : null}
    </fieldset>
  );
}

interface LibraryRoute {
  id: string;
  name: string;
  distance_m: number;
  ascent_m: number | null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="kit-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
