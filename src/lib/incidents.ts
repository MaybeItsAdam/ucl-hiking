export const INCIDENT_KINDS = ["injury", "illness", "near_miss", "lost_person", "equipment", "other"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const INCIDENT_LABELS: Record<IncidentKind, string> = {
  injury: "Injury",
  illness: "Illness",
  near_miss: "Near miss",
  lost_person: "Someone lost or separated",
  equipment: "Kit failure",
  other: "Something else",
};

export interface IncidentInput {
  event_suu_id: string | null;
  occurred_at: string;
  kind: IncidentKind;
  description: string;
  actions_taken: string | null;
  follow_up: string | null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

export function parseIncident(body: unknown, now = new Date()): { ok: true; incident: IncidentInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Send the report as JSON." };
  const b = body as Record<string, unknown>;
  if (!INCIDENT_KINDS.includes(b.kind as IncidentKind)) return { ok: false, error: "Choose what kind of incident it was." };
  const description = text(b.description, 4000);
  if (!description) return { ok: false, error: "Say what happened." };
  const when = b.occurred_at ? new Date(String(b.occurred_at)) : now;
  if (Number.isNaN(when.getTime())) return { ok: false, error: "The time isn't a date." };
  if (when.getTime() > now.getTime() + 5 * 60 * 1000) return { ok: false, error: "The time is in the future." };
  return {
    ok: true,
    incident: {
      event_suu_id: text(b.event_suu_id, 200),
      occurred_at: when.toISOString(),
      kind: b.kind as IncidentKind,
      description,
      actions_taken: text(b.actions_taken, 4000),
      follow_up: text(b.follow_up, 4000),
    },
  };
}
