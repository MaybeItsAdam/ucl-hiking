import { describe, expect, it } from "vitest";
import { eventDetails, eventKind, reflow } from "./eventDetails";

// Trimmed from a real Toolbox post: a hard break at every inline tag.
const SEVEN_SISTERS = [
  "This iconic coastal hike takes you along the chalk cliffs of the Seven Sisters 🌊. A must-do adventure! 🌤️👣",
  "📐 DISTANCE:", "21.85km",
  "🏔️ TOTAL ASCENT:", "501m",
  "⚖️ DIFFICULTY:", "Difficult ⚫ (See Difficulty Grading Scale (🟢🔵🔴⚫) below)",
  "💰 TRAIN TICKET COST:", "approx.", "£31.65", "with a", "16–25 Railcard (recommended)",
  "⏱️Expected Day Schedule :",
  "Morning departure from", "London Bridge", "Station (exact details after ticket sign-up).",
  "Around", "99", "minutes travelling together to", "Seaford", ". Take the time to get to know others on the hike!",
  "Finish the hike near", "Eastbourne", "station, return to London by early evening.",
  "🎒 WHAT TO BRING:",
  "Hiking boots 🥾 or good waterproof shoes/trainers you don’t mind getting muddy",
  "Raincoat 🌧️ / sunscreen 🌤️ depending on weather",
].join("\n");

describe("reflow", () => {
  it("rejoins sentences split at inline tags and keeps real breaks", () => {
    const lines = reflow(SEVEN_SISTERS);
    expect(lines).toContain("Morning departure from London Bridge Station (exact details after ticket sign-up).");
    expect(lines).toContain("Around 99 minutes travelling together to Seaford. Take the time to get to know others on the hike!");
    expect(lines).toContain("Hiking boots 🥾 or good waterproof shoes/trainers you don’t mind getting muddy");
    expect(lines).toContain("Raincoat 🌧️ / sunscreen 🌤️ depending on weather");
    expect(lines).toContain("📐 DISTANCE:");
  });
});

describe("eventDetails", () => {
  it("reads a walk post's title and fact sheet", () => {
    const d = eventDetails({
      title: "🌳 Taster Hike (8 of 8): Seven Sisters #2 (22km)",
      description: SEVEN_SISTERS,
      location: "The Great Outdoors",
    });
    expect(d).toMatchObject({
      kind: "hike",
      emoji: "🌳",
      eyebrow: "Taster Hike (8 of 8)",
      name: "Seven Sisters #2",
      distanceKm: 21.85,
      ascentM: 501,
      difficulty: "difficult",
      trainFare: "£31.65",
      meetingPoint: "London Bridge Station",
      start: "Seaford",
      finish: "Eastbourne",
    });
    expect(d.lead).toMatch(/^This iconic coastal hike/);
    expect(d.more[0]).toBe("📐 DISTANCE:");
  });

  it("falls back to the title's route and the distance in brackets", () => {
    const d = eventDetails({ title: "👣 Walk: Capital Ring (Section 13/14): Highgate to Stratford (16km)", description: null, location: null });
    expect(d).toMatchObject({ kind: "walk", eyebrow: "Walk", start: "Highgate", finish: "Stratford", distanceKm: 16 });
  });

  it("does not split a title at a colon inside brackets", () => {
    const d = eventDetails({ title: "👣 Walk (Charity Hike: LGBTQ+ History Month): Lewes to Brighton (13km)", description: null, location: null });
    expect(d.eyebrow).toBe("Walk (Charity Hike: LGBTQ+ History Month)");
    expect(d.name).toBe("Lewes to Brighton");
    expect(d.kind).toBe("walk");
  });

  it("treats a circular as finishing where it started", () => {
    const d = eventDetails({
      title: "🌻 Taster Walk (3 of 8): Sevenoaks Circular (15km)",
      description: "minutes travelling together to\nSevenoaks\n. Take the time",
      location: null,
    });
    expect([d.start, d.finish]).toEqual(["Sevenoaks", "Sevenoaks"]);
  });

  it("leaves a social's venue as where to meet", () => {
    const d = eventDetails({ title: "🎉 Social: 👋✨ Meet the Committee 👥🤝", description: "Come and say hi.", location: "Mully's" });
    expect(d).toMatchObject({ kind: "social", name: "Meet the Committee", meetingPoint: "Mully's", start: null, distanceKm: null });
  });
});

describe("eventKind", () => {
  it("files training under club even when it says walk", () => {
    expect(eventKind("⛑️ Walk Leader Induction #2")).toBe("club");
    expect(eventKind("⛑️🎉 WL Social: Gaming Night 🎮")).toBe("social");
    expect(eventKind("UCL Hiking Club: Snowdonia Residential Trip")).toBe("trip");
    expect(eventKind("This Girl Can: Hike (Ivinghoe Beacon- 14km)")).toBe("hike");
  });
});
