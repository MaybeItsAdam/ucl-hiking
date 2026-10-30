import { describe, expect, it } from "vitest";
import { compassPoint, inForecastWindow, londonDay, pickDay, walkHours, weatherSummary, type HourForecast } from "./weather";

describe("weather", () => {
  it("names WMO codes", () => {
    expect(weatherSummary(0)).toBe("Clear");
    expect(weatherSummary(3)).toBe("Overcast");
    expect(weatherSummary(63)).toBe("Rain");
    expect(weatherSummary(81)).toBe("Showers");
    expect(weatherSummary(95)).toBe("Thunderstorms");
  });

  it("uses the London day, not the UTC one", () => {
    // 23:30 UTC on 30 June is already 1 July in London (BST).
    expect(londonDay("2026-06-30T23:30:00Z")).toBe("2026-07-01");
    expect(londonDay("2026-12-31T23:30:00Z")).toBe("2026-12-31");
  });

  it("only forecasts the coming week", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(inForecastWindow("2026-10-12T08:00:00Z", now)).toBe(true);
    expect(inForecastWindow("2026-10-20T08:00:00Z", now)).toBe(false);
    expect(inForecastWindow("2026-10-09T08:00:00Z", now)).toBe(false);
    expect(inForecastWindow(null, now)).toBe(false);
  });

  it("picks the walk's day out of Open-Meteo's arrays", () => {
    const daily = {
      time: ["2026-10-17", "2026-10-18"],
      weather_code: [0, 61],
      temperature_2m_max: [14.2, 12.6],
      temperature_2m_min: [6.1, 7.4],
      precipitation_probability_max: [5, 70],
      wind_speed_10m_max: [10.4, 22.5],
      wind_gusts_10m_max: [20, 48.9],
      sunrise: ["2026-10-17T07:28", "2026-10-18T07:30"],
      sunset: ["2026-10-17T18:03", "2026-10-18T18:01"],
    };
    expect(pickDay(daily, "2026-10-18")).toEqual({
      date: "2026-10-18",
      code: 61,
      summary: "Rain",
      tempMin: 7,
      tempMax: 13,
      feelsMin: null,
      feelsMax: null,
      rainChance: 70,
      rainMm: null,
      windMaxKmh: 23,
      gustMaxKmh: 49,
      windFrom: null,
      uvMax: null,
      sunrise: "2026-10-18T07:30",
      sunset: "2026-10-18T18:01",
      hours: [],
    });
    expect(pickDay(daily, "2026-10-19")).toBeNull();
  });

  it("keeps only the walk's day out of the hourly arrays", () => {
    const daily = { time: ["2026-10-18"], temperature_2m_max: [12], temperature_2m_min: [7] };
    const hourly = {
      time: ["2026-10-17T23:00", "2026-10-18T09:00", "2026-10-18T10:00"],
      weather_code: [3, 80, null],
      is_day: [0, 1, 1],
      temperature_2m: [6, 9.4, null],
      precipitation: [0, 1.26, 0],
      wind_direction_10m: [0, 225, 0],
    };
    const hours = pickDay(daily, "2026-10-18", hourly)!.hours;
    expect(hours).toHaveLength(1);
    expect(hours[0]).toMatchObject({ hour: 9, summary: "Showers", isDay: true, temp: 9, rainMm: 1.3, windFrom: "SW" });
  });

  it("names the compass point the wind comes from", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(350)).toBe("N");
    expect(compassPoint(100)).toBe("E");
    expect(compassPoint(-90)).toBe("W");
    expect(compassPoint(null)).toBeNull();
  });

  it("lists daylight and the walk, marking the walk's hours", () => {
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, temp: 10 }) as HourForecast);
    const day = { date: "2026-10-18", hours, sunrise: "2026-10-18T07:30", sunset: "2026-10-18T18:01" };
    // 09:00 to 16:00 BST.
    const rows = walkHours(day, "2026-10-18T08:00:00Z", "2026-10-18T15:00:00Z");
    expect(rows.map((h) => h.hour)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(rows.filter((h) => h.walk).map((h) => h.hour)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    // No end, or an end on another day: the walk runs until dark.
    expect(walkHours(day, "2026-10-18T08:00:00Z", "2026-10-19T15:00:00Z").filter((h) => h.walk).at(-1)?.hour).toBe(18);
    expect(walkHours(day, null, null).filter((h) => h.walk)[0]?.hour).toBe(7);
  });
});
