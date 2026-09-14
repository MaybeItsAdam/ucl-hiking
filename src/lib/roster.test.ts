import { describe, expect, it } from "vitest";
import { matchRosterByName, nameTokens, tierFromMembershipType, type RosterEntry } from "./roster";

const entry = (full_name: string, membership_tier: RosterEntry["membership_tier"] = "taster"): RosterEntry => ({
  full_name,
  membership_tier,
  membership_expires_at: null,
});

describe("tierFromMembershipType", () => {
  it("maps the SU membership products", () => {
    expect(tierFromMembershipType("Taster")).toBe("taster");
    expect(tierFromMembershipType("Explorer")).toBe("explorer");
    expect(tierFromMembershipType("Standard Membership")).toBe("standard");
  });

  it("refuses unknown or ambiguous products", () => {
    expect(tierFromMembershipType("Life member")).toBeNull();
    expect(tierFromMembershipType("Taster to Explorer upgrade")).toBeNull();
    expect(tierFromMembershipType(null)).toBeNull();
  });
});

describe("nameTokens", () => {
  it("ignores case, accents, punctuation and order", () => {
    expect([...nameTokens("  Siobhán  O'Neil ")]).toEqual(["siobhan", "o", "neil"]);
    expect(nameTokens("Cleary, Adam")).toEqual(nameTokens("adam cleary"));
  });
});

describe("matchRosterByName", () => {
  const roster = [entry("Ada Lovelace", "explorer"), entry("Alan Mathison Turing"), entry("Sam Lee"), entry("Sam Lee")];

  it("matches an exact name regardless of order and case", () => {
    expect(matchRosterByName(roster, "lovelace ada")?.membership_tier).toBe("explorer");
  });

  it("matches when one side has a middle name", () => {
    expect(matchRosterByName(roster, "Alan Turing")?.full_name).toBe("Alan Mathison Turing");
  });

  it("refuses shared names, single names and strangers", () => {
    expect(matchRosterByName(roster, "Sam Lee")).toBeNull();
    expect(matchRosterByName(roster, "Ada")).toBeNull();
    expect(matchRosterByName(roster, "Grace Hopper")).toBeNull();
  });

  it("refuses a partial match that fits more than one entry", () => {
    expect(matchRosterByName([entry("Alex Kim Park"), entry("Alex Jo Park")], "Alex Park")).toBeNull();
  });
});
