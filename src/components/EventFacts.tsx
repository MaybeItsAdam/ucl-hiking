import { Mountain, Route, TrainFront } from "lucide-react";
import { DIFFICULTY_LABELS, formatAscent, formatKm, type EventDetails } from "@/lib/eventDetails";

/** The club's grading as a coloured dot and a word: green, blue, red, black. */
export function DifficultyChip({ difficulty }: { difficulty: NonNullable<EventDetails["difficulty"]> }) {
  return (
    <span className={`event-chip difficulty is-${difficulty}`}>
      <span className="difficulty-dot" aria-hidden="true" />
      {DIFFICULTY_LABELS[difficulty]}
    </span>
  );
}

/** Distance, climb and grade in a row of chips; nothing at all for an event that has none. */
export function EventFacts({ details, fare = false }: { details: EventDetails; fare?: boolean }) {
  const { distanceKm, ascentM, difficulty, trainFare } = details;
  if (distanceKm === null && ascentM === null && !difficulty) return null;
  return (
    <div className="event-facts">
      {distanceKm !== null ? (
        <span className="event-chip">
          <Route size={13} aria-hidden="true" />
          {formatKm(distanceKm)}
        </span>
      ) : null}
      {ascentM !== null ? (
        <span className="event-chip">
          <Mountain size={13} aria-hidden="true" />
          {formatAscent(ascentM)}
          <span className="sr-only"> of ascent</span>
        </span>
      ) : null}
      {difficulty ? <DifficultyChip difficulty={difficulty} /> : null}
      {fare && trainFare ? (
        <span className="event-chip">
          <TrainFront size={13} aria-hidden="true" />
          {trainFare}
        </span>
      ) : null}
    </div>
  );
}

/** "Seaford → Eastbourne", or "Richmond circular". */
export function routeLabel({ start, finish }: Pick<EventDetails, "start" | "finish">): string | null {
  if (!start && !finish) return null;
  if (start && (!finish || finish === start)) return finish ? `${start} circular` : `From ${start}`;
  return `${start ?? "?"} → ${finish}`;
}
