import type { LatLng } from "@/lib/places";

/**
 * The day's forecast for a walk, from Open-Meteo (free, no key). Shown only in
 * the last week before a walk: further out a forecast is more noise than help.
 */

export const FORECAST_WINDOW_DAYS = 7;

export interface DayForecast {
  date: string;
  summary: string;
  tempMin: number;
  tempMax: number;
  rainChance: number | null;
  windMaxKmh: number | null;
  gustMaxKmh: number | null;
  sunrise: string | null;
  sunset: string | null;
}

interface OpenMeteoDaily {
  time: string[];
  weather_code?: (number | null)[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  precipitation_probability_max?: (number | null)[];
  wind_speed_10m_max?: (number | null)[];
  wind_gusts_10m_max?: (number | null)[];
  sunrise?: (string | null)[];
  sunset?: (string | null)[];
}

/** WMO weather codes, as Open-Meteo reports them, in words. */
export function weatherSummary(code: number | null | undefined): string {
  if (code === null || code === undefined) return "Forecast";
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorms";
}

/** The London calendar day an instant falls on, as YYYY-MM-DD. */
export function londonDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

/** Is the walk close enough, and not yet over, for a forecast to be worth showing? */
export function inForecastWindow(startsAt: string | null, now = new Date()): boolean {
  if (!startsAt) return false;
  const until = new Date(startsAt).getTime() - now.getTime();
  return until > -12 * 60 * 60 * 1000 && until < FORECAST_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/** Pick one day out of Open-Meteo's daily arrays. */
export function pickDay(daily: OpenMeteoDaily, date: string): DayForecast | null {
  const i = daily.time.indexOf(date);
  if (i < 0) return null;
  const min = daily.temperature_2m_min[i];
  const max = daily.temperature_2m_max[i];
  if (min === null || max === null || min === undefined || max === undefined) return null;
  return {
    date,
    summary: weatherSummary(daily.weather_code?.[i]),
    tempMin: Math.round(min),
    tempMax: Math.round(max),
    rainChance: daily.precipitation_probability_max?.[i] ?? null,
    windMaxKmh: daily.wind_speed_10m_max?.[i] != null ? Math.round(daily.wind_speed_10m_max[i]!) : null,
    gustMaxKmh: daily.wind_gusts_10m_max?.[i] != null ? Math.round(daily.wind_gusts_10m_max[i]!) : null,
    sunrise: daily.sunrise?.[i] ?? null,
    sunset: daily.sunset?.[i] ?? null,
  };
}

/**
 * The forecast for `startsAt` at `at`, or null when out of range or Open-Meteo
 * is unreachable. Cached for an hour so an event page never waits on it twice.
 */
export async function getWalkForecast(at: LatLng, startsAt: string | null): Promise<DayForecast | null> {
  if (!startsAt || !inForecastWindow(startsAt)) return null;
  const date = londonDay(startsAt);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", at[0].toFixed(4));
  url.searchParams.set("longitude", at[1].toFixed(4));
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset",
  );
  url.searchParams.set("timezone", "Europe/London");
  url.searchParams.set("start_date", date);
  url.searchParams.set("end_date", date);
  try {
    const res = await fetch(url, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { daily?: OpenMeteoDaily };
    return body.daily ? pickDay(body.daily, date) : null;
  } catch {
    return null;
  }
}
