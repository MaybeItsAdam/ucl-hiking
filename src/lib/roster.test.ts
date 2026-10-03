import { describe, expect, it } from "vitest";
import {
  buildMembershipList,
  type RosterAccount,
  type RosterEntry,
} from "./roster";

const entry = (full_name: string, membership_tier: RosterEntry["membership_tier"] = "taster"): RosterEntry => ({
  full_name,
  membership_tier,
  membership_expires_at: null,
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

  it("attaches accounts to roster rows by linked login and keeps the roster's tier", () => {
    const list = buildMembershipList(
      [rosterRow("r1", "Zoe Adams"), { ...rosterRow("r2", "Adam Cleary"), toolbox_user_id: "t2" }],
      [account("a1", "Adam C", { toolbox_user_id: "t2", governance_role: "admin", is_walk_leader: true })],
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

  it("never attaches by name, and lists unattached accounts after the roster", () => {
    const list = buildMembershipList(
      [rosterRow("r1", "Zoe Adams")],
      [account("a1", null, { governance_role: "committee" }), account("a2", "Zoe Adams")],
    );
    expect(list.map((row) => [row.id, row.on_roster])).toEqual([
      ["r1", true],
      ["a1", false],
      ["a2", false],
    ]);
    expect(list[0]).toMatchObject({ member_id: null });
    expect(list[1]).toMatchObject({ full_name: "a1", membership_tier: "explorer", governance_role: "committee" });
  });
});
