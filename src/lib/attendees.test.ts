import { describe, expect, it } from "vitest";
import { collapseOps, headcount, parseAttendanceOps, planAttendeeSync, walkRole, type Attendee } from "./attendees";

const row = (over: Partial<Attendee>): Attendee => ({
  id: "a",
  event_suu_id: "ev",
  member_id: null,
  name: "Someone",
  email: null,
  source: "toolbox",
  removed: false,
  checked_in_at: null,
  returned_at: null,
  ...over,
});

const members = [{ id: "m1", email: "ada@ucl.ac.uk", full_name: "Ada Lovelace" }];

describe("planAttendeeSync", () => {
  it("adds new ticket holders and links them to members by email", () => {
    const plan = planAttendeeSync("ev", [], [{ name: "Ada L", email: " ADA@ucl.ac.uk " }, { email: "guest@example.com" }], members);
    expect(plan.insert).toEqual([
      { event_suu_id: "ev", member_id: "m1", name: "Ada L", email: "ada@ucl.ac.uk", source: "toolbox", removed: false },
      { event_suu_id: "ev", member_id: null, name: "guest", email: "guest@example.com", source: "toolbox", removed: false },
    ]);
  });

  it("marks refunds removed but never someone already checked in, and never leader-added rows", () => {
    const existing = [
      row({ id: "refund", email: "gone@x.com" }),
      row({ id: "on-hill", email: "late-refund@x.com", checked_in_at: "2026-10-18T08:00:00Z" }),
      row({ id: "walkup", source: "leader", name: "Walk-up" }),
      row({ id: "stays", email: "ada@ucl.ac.uk", member_id: "m1", name: "Ada Lovelace" }),
    ];
    const plan = planAttendeeSync("ev", existing, [{ name: "Ada Lovelace", email: "ada@ucl.ac.uk" }], members);
    expect(plan.remove).toEqual(["refund"]);
    expect(plan.insert).toEqual([]);
    expect(plan.update).toEqual([]);
  });

  it("brings back a refunded ticket holder who rebooks", () => {
    const plan = planAttendeeSync("ev", [row({ id: "back", email: "ada@ucl.ac.uk", removed: true, member_id: "m1", name: "Ada" })], [{ name: "Ada", email: "ada@ucl.ac.uk" }], members);
    expect(plan.update).toEqual([{ id: "back", name: "Ada", member_id: "m1", removed: false }]);
  });

  it("doesn't duplicate a member a leader already added", () => {
    const plan = planAttendeeSync("ev", [row({ id: "added", source: "leader", member_id: "m1", email: "ada@ucl.ac.uk" })], [{ email: "ada@ucl.ac.uk" }], members);
    expect(plan).toEqual({ insert: [], update: [], remove: [] });
  });

  it("treats an empty list as a hiccup, not everyone refunding", () => {
    expect(planAttendeeSync("ev", [row({ id: "x", email: "a@b.com" })], [], members).remove).toEqual([]);
  });
});

describe("walkRole", () => {
  const plan = { leader_member_id: "L", backmarker_member_id: "B" };
  const base = { membershipTier: "standard" as const, governanceRole: null, isWalkLeader: true };
  it("knows the leader, the backmarker, and committee", () => {
    expect(walkRole({ id: "L", ...base }, plan)).toBe("leader");
    expect(walkRole({ id: "B", ...base }, plan)).toBe("backmarker");
    expect(walkRole({ id: "C", ...base, governanceRole: "committee" }, plan)).toBe("committee");
  });
  it("gives another walk's leader nothing", () => {
    expect(walkRole({ id: "X", ...base }, plan)).toBeNull();
    expect(walkRole({ id: "X", ...base }, null)).toBeNull();
  });
});

describe("register", () => {
  it("counts only people still on it", () => {
    expect(
      headcount([
        row({ checked_in_at: "t", returned_at: "t" }),
        row({ checked_in_at: "t" }),
        row({}),
        row({ removed: true, checked_in_at: "t" }),
      ]),
    ).toEqual({ expected: 3, checkedIn: 2, missing: 1, returned: 1 });
  });

  it("validates and collapses a queue to each person's last tap", () => {
    const ops = parseAttendanceOps([
      { kind: "check_in", attendeeId: "a", at: "2026-10-18T08:00:00Z" },
      { kind: "check_in", attendeeId: "b", at: "2026-10-18T08:01:00Z" },
      { kind: "undo_check_in", attendeeId: "a", at: "2026-10-18T08:02:00Z" },
      { kind: "all_back", at: "2026-10-18T17:00:00Z" },
    ])!;
    const { checkIns, allBackAt } = collapseOps(ops);
    expect([...checkIns]).toEqual([
      ["a", null],
      ["b", "2026-10-18T08:01:00.000Z"],
    ]);
    expect(allBackAt).toBe("2026-10-18T17:00:00.000Z");
    expect(parseAttendanceOps([{ kind: "check_in", at: "nope", attendeeId: "a" }])).toBeNull();
    expect(parseAttendanceOps("x")).toBeNull();
  });
});
