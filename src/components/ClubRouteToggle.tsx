"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";

/**
 * Marks a route as one of the club's, or unmarks it, in one tap. The star
 * fills straight away and the list catches up behind it. A route named
 * "… [CLUB]" in OS Maps is a club route whatever the mark says, so its star
 * is fixed on.
 */
export function ClubRouteToggle({
  id,
  club,
  taggedInName,
  label = false,
}: {
  id: string;
  club: boolean;
  taggedInName: boolean;
  /** Show "Club route" beside the star (the route's own page). */
  label?: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(club);
  const [error, setError] = useState(false);
  const [, startTransition] = useTransition();
  const locked = taggedInName;

  async function toggle() {
    const next = !on;
    setOn(next);
    setError(false);
    const res = await fetch(`/api/osmaps/routes/${encodeURIComponent(id)}/club`, { method: next ? "PUT" : "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setOn(!next);
      setError(true);
      return;
    }
    startTransition(() => router.refresh());
  }

  const title = locked
    ? "Named [CLUB] in OS Maps, so always a club route"
    : on
      ? "Club route: tap to take it off the club list"
      : "Mark as a club route";
  return (
    <button
      type="button"
      className={`club-toggle${on ? " is-on" : ""}${label ? " has-label" : ""}${error ? " is-error" : ""}`}
      aria-pressed={on}
      aria-label={label ? undefined : title}
      title={title}
      disabled={locked}
      onClick={() => void toggle()}
    >
      <Star size={18} aria-hidden="true" fill={on ? "currentColor" : "none"} />
      {label ? <span>{error ? "Didn't save, try again" : on ? "Club route" : "Mark as club route"}</span> : null}
    </button>
  );
}
