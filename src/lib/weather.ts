import type { LatLng } from "@/lib/places";

/**
 * The day's forecast for a walk, from Open-Meteo (free, no key). Shown only in
 * the last week before a walk: further out a forecast is more noise than help.
 */

export const FORECAST_WINDOW_DAYS = 7;

export interface HourForecast {
  /** London wall-clock hour, 0–23. */
  hour: number;
  code: number | null;
  summary: string;
  isDay: boolean;
  temp: number;
  feelsLike: number | null;
  rainChance: number | null;
  rainMm: number | null;
  windKmh: number | null;
  gustKmh: number | null;
  /** Where the wind blows from, as a compass point. */
  windFrom: string | null;
}

export interface DayForecast {
  date: string;
  code: number | null;
  summary: string;
  tempMin: number;
  tempMax: number;
  feelsMin: number | null;
  feelsMax: number | null;
  rainChance: number | null;
  rainMm: number | null;
  windMaxKmh: number | null;
  gustMaxKmh: number | null;
  windFrom: string | null;
  uvMax: number | null;
  sunrise: string | null;
  sunset: string | null;
  hours: HourForecast[];
}

interface OpenMeteoDaily {
  time: string[];
  weather_code?: (number | null)[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  apparent_temperature_max?: (number | null)[];
  apparent_temperature_min?: (number | null)[];
  precipitation_probability_max?: (number | null)[];
  precipitation_sum?: (number | null)[];
  wind_speed_10m_max?: (number | null)[];
  wind_gusts_10m_max?: (number | null)[];
  wind_direction_10m_dominant?: (number | null)[];
  uv_index_max?: (number | null)[];
  sunrise?: (string | null)[];
  sunset?: (string | null)[];
}

interface OpenMeteoHourly {
  time: string[];
  weather_code?: (number | null)[];
  is_day?: (number | null)[];
  temperature_2m: (number | null)[];
  apparent_temperature?: (number | null)[];
  precipitation_probability?: (number | null)[];
  precipitation?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  wind_gusts_10m?: (number | null)[];
  wind_direction_10m?: (number | null)[];
}

const DAILY_FIELDS = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "apparent_temperature_max",
  "apparent_temperature_min",
  "precipitation_probability_max",
  "precipitation_sum",
  "wind_speed_10m_max",
  "wind_gusts_10m_max",
  "wind_direction_10m_dominant",
  "uv_index_max",
  "sunrise",
  "sunset",
];

const HOURLY_FIELDS = [
  "weather_code",
  "is_day",
  "temperature_2m",
  "apparent_temperature",
  "precipitation_probability",
  "precipitation",
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m",
];

const round = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n));
/** Millimetres to one decimal, which is as fine as a forecast means it. */
const mm = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** A wind bearing in degrees as the compass point it blows from. */
export function compassPoint(degrees: number | null | undefined): string | null {
  if (degrees === null || degrees === undefined) return null;
  return POINTS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
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

/** The hours of `date` out of Open-Meteo's hourly arrays (local times, so the prefix is the day). */
export function pickHours(hourly: OpenMeteoHourly | undefined, date: string): HourForecast[] {
  if (!hourly) return [];
  const hours: HourForecast[] = [];
  hourly.time.forEach((time, i) => {
    const temp = hourly.temperature_2m[i];
    if (!time.startsWith(date) || temp === null || temp === undefined) return;
    const code = hourly.weather_code?.[i] ?? null;
    hours.push({
      hour: Number(time.slice(11, 13)),
      code,
      summary: weatherSummary(code),
      isDay: hourly.is_day?.[i] !== 0,
      temp: Math.round(temp),
      feelsLike: round(hourly.apparent_temperature?.[i]),
      rainChance: hourly.precipitation_probability?.[i] ?? null,
      rainMm: mm(hourly.precipitation?.[i]),
      windKmh: round(hourly.wind_speed_10m?.[i]),
      gustKmh: round(hourly.wind_gusts_10m?.[i]),
      windFrom: compassPoint(hourly.wind_direction_10m?.[i]),
    });
  });
  return hours;
}

/** Pick one day out of Open-Meteo's daily arrays, with its hours if they came too. */
export function pickDay(daily: OpenMeteoDaily, date: string, hourly?: OpenMeteoHourly): DayForecast | null {
  const i = daily.time.indexOf(date);
  if (i < 0) return null;
  const min = daily.temperature_2m_min[i];
  const max = daily.temperature_2m_max[i];
  if (min === null || max === null || min === undefined || max === undefined) return null;
  return {
    date,
    code: daily.weather_code?.[i] ?? null,
    summary: weatherSummary(daily.weather_code?.[i]),
    tempMin: Math.round(min),
    tempMax: Math.round(max),
    feelsMin: round(daily.apparent_temperature_min?.[i]),
    feelsMax: round(daily.apparent_temperature_max?.[i]),
    rainChance: daily.precipitation_probability_max?.[i] ?? null,
    rainMm: mm(daily.precipitation_sum?.[i]),
    windMaxKmh: round(daily.wind_speed_10m_max?.[i]),
    gustMaxKmh: round(daily.wind_gusts_10m_max?.[i]),
    windFrom: compassPoint(daily.wind_direction_10m_dominant?.[i]),
    uvMax: round(daily.uv_index_max?.[i]),
    sunrise: daily.sunrise?.[i] ?? null,
    sunset: daily.sunset?.[i] ?? null,
    hours: pickHours(hourly, date),
  };
}

/** The London wall-clock hour an instant falls in. */
function londonHour(iso: string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)),
  );
}

/**
 * The hours worth a row in the hour-by-hour list: daylight, stretched to take
 * in the whole walk, each marked when it falls during the walk itself. A walk
 * with no end time, or one that runs into another day, is taken to last until
 * dark.
 */
export function walkHours(
  forecast: Pick<DayForecast, "date" | "hours" | "sunrise" | "sunset">,
  startsAt: string | null,
  endsAt: string | null,
): (HourForecast & { walk: boolean })[] {
  const sunrise = forecast.sunrise ? Number(forecast.sunrise.slice(11, 13)) : 7;
  const sunset = forecast.sunset ? Number(forecast.sunset.slice(11, 13)) : 18;
  const from = startsAt ? londonHour(startsAt) : sunrise;
  const to = endsAt && londonDay(endsAt) === forecast.date ? londonHour(endsAt) : sunset;
  const first = Math.min(from - 1, sunrise);
  const last = Math.max(to + 1, sunset + 1);
  return forecast.hours
    .filter((h) => h.hour >= first && h.hour <= last)
    .map((h) => ({ ...h, walk: h.hour >= from && h.hour <= Math.max(from, to) }));
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
  url.searchParams.set("daily", DAILY_FIELDS.join(","));
  url.searchParams.set("hourly", HOURLY_FIELDS.join(","));
  url.searchParams.set("timezone", "Europe/London");
  url.searchParams.set("start_date", date);
  url.searchParams.set("end_date", date);
  try {
    const res = await fetch(url, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { daily?: OpenMeteoDaily; hourly?: OpenMeteoHourly };
    return body.daily ? pickDay(body.daily, date, body.hourly) : null;
  } catch {
    return null;
  }
}
