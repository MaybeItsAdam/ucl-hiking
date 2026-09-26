import { describe, expect, it } from "vitest";
import { inForecastWindow, londonDay, pickDay, weatherSummary } from "./weather";

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
      summary: "Rain",
      tempMin: 7,
      tempMax: 13,
      rainChance: 70,
      windMaxKmh: 23,
      gustMaxKmh: 49,
      sunrise: "2026-10-18T07:30",
      sunset: "2026-10-18T18:01",
    });
    expect(pickDay(daily, "2026-10-19")).toBeNull();
  });
});
