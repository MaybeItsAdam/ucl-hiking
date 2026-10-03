import { describe, expect, it } from "vitest";
import {
  buildMembershipList,
  matchRosterByName,
  nameTokens,
  type RosterAccount,
  type RosterEntry,
} from "./roster";

const entry = (full_name: string, membership_tier: RosterEntry["membership_tier"] = "taster"): RosterEntry => ({
  full_name,
  membership_tier,
  membership_expires_at: null,
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

describe("buildMembershipList", () => {
  const rosterRow = (id: string, full_name: string) => ({ ...entry(full_name), id, member_type: "Student member" });
  const account = (id: string, full_name: string | null, extra: Partial<RosterAccount> = {}): RosterAccount => ({
    id,
    email: `${id}@ucl.ac.uk`,
    full_name,
    membership_tier: "explorer",
    governance_role: null,
    is_walk_leader: false,
    membership_expires_at: null,
    ...extra,
  });

  it("attaches matched accounts to roster rows and keeps the roster's tier", () => {
    const list = buildMembershipList(
      [rosterRow("r1", "Zoe Adams"), rosterRow("r2", "Adam Cleary")],
      [account("a1", "Cleary, Adam", { governance_role: "admin", is_walk_leader: true })],
    );
    expect(list.map((row) => row.full_name)).toEqual(["Adam Cleary", "Zoe Adams"]);
    expect(list[0]).toMatchObject({
      id: "r2",
      email: "a1@ucl.ac.uk",
      membership_tier: "taster",
      governance_role: "admin",
      is_walk_leader: true,
      on_roster: true,
    });
    expect(list[1]).toMatchObject({ email: null, governance_role: null, on_roster: true });
  });

  it("attaches a confirmed Toolbox login before trying names", () => {
    const list = buildMembershipList(
      [{ ...rosterRow("r1", "Sam Lee"), toolbox_user_id: "t1" }, rosterRow("r2", "Sam Lee")],
      [account("a1", "Samuel Lee-Smith", { toolbox_user_id: "t1" })],
    );
    expect(list.find((row) => row.id === "r1")).toMatchObject({ member_id: "a1", on_roster: true });
    expect(list.filter((row) => !row.on_roster)).toEqual([]);
  });

  it("lists accounts nobody on the roster matches after the roster", () => {
    const list = buildMembershipList(
      [rosterRow("r1", "Zoe Adams")],
      [account("a1", null, { governance_role: "committee" }), account("a2", "Zoe Adams"), account("a3", "Zoe Adams")],
    );
    expect(list.map((row) => [row.id, row.on_roster])).toEqual([
      ["r1", true],
      ["a1", false],
      ["a3", false],
    ]);
    expect(list[1]).toMatchObject({ full_name: "a1", membership_tier: "explorer", governance_role: "committee" });
  });
});
