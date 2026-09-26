import { eventDetails } from "@/lib/eventDetails";
import type { EventPlanView } from "@/lib/eventPlans";
import type { DayForecast } from "@/lib/weather";
import { londonDay } from "@/lib/weather";
import type { SUEvent } from "@/lib/types";

const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

/** The London date one day after `now`, as YYYY-MM-DD. */
export function tomorrowInLondon(now = new Date()): string {
  return londonDay(new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString());
}

export function isTomorrow(event: Pick<SUEvent, "starts_at">, now = new Date()): boolean {
  return Boolean(event.starts_at) && londonDay(event.starts_at!) === tomorrowInLondon(now);
}

/** "Meet 08:40 at Victoria · bring waterproofs, lunch · Rain, 9–13°C, 60% rain" */
export function reminderMessage(event: SUEvent, plan: EventPlanView | null, forecast: DayForecast | null) {
  const name = eventDetails(event).name;
  const meetAt = plan?.meet_at ? clock.format(new Date(plan.meet_at)) : event.starts_at && !event.is_all_day ? clock.format(new Date(event.starts_at)) : null;
  const meetPoint = plan?.meet_point ?? eventDetails(event).meetingPoint;
  const parts = [
    meetAt || meetPoint ? `Meet ${[meetAt, meetPoint].filter(Boolean).join(" at ")}` : null,
    plan?.kit_list.length ? `bring ${plan.kit_list.slice(0, 3).join(", ").toLowerCase()}${plan.kit_list.length > 3 ? "…" : ""}` : null,
    forecast
      ? `${forecast.summary}, ${forecast.tempMin}–${forecast.tempMax}°C${forecast.rainChance !== null ? `, ${forecast.rainChance}% rain` : ""}`
      : null,
  ].filter(Boolean);
  return { title: `Tomorrow: ${name}`, body: parts.join(" · ") || "Check the event page for the details." };
}
