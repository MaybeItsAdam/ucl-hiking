import { describe, expect, it } from "vitest";
import { canEditPlan, mergePlanForEditor, parseKitList, parsePlanInput, type PlanInput } from "./eventPlans";

const leader = { membershipTier: "standard", governanceRole: null, isWalkLeader: true } as const;
const committee = { membershipTier: "explorer", governanceRole: "committee", isWalkLeader: false } as const;
const member = { membershipTier: "explorer", governanceRole: null, isWalkLeader: false } as const;
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

describe("parseKitList", () => {
  it("takes one item per line, dropping blanks and repeats", () => {
    expect(parseKitList("Boots\n\n  Waterproof \nboots\nLunch")).toEqual(["Boots", "Waterproof", "Lunch"]);
  });
  it("accepts an array too", () => {
    expect(parseKitList(["Map", "Compass", 3])).toEqual(["Map", "Compass"]);
  });
});

describe("parsePlanInput", () => {
  it("normalises a full plan", () => {
    const result = parsePlanInput({
      leader_member_id: ID_A,
      backmarker_member_id: "not-a-uuid",
      meet_at: "2026-10-18T08:30:00.000Z",
      meet_point: "  Euston  ",
      transport: "",
      kit_list: "Boots",
      route_url: "https://explore.osmaps.com/route/1",
      booking_url: "",
      notes: "Bring a torch",
    });
    expect(result).toEqual({
      ok: true,
      plan: {
        leader_member_id: ID_A,
        backmarker_member_id: null,
        meet_at: "2026-10-18T08:30:00.000Z",
        meet_point: "Euston",
        transport: null,
        kit_list: ["Boots"],
        route_url: "https://explore.osmaps.com/route/1",
        booking_url: null,
        notes: "Bring a torch",
      },
    });
  });

  it("refuses a link that isn't http(s) instead of silently dropping it", () => {
    expect(parsePlanInput({ route_url: "javascript:alert(1)" })).toEqual({ ok: false, error: "The route link must start with https://." });
    expect(parsePlanInput({ booking_url: "ftp://x" }).ok).toBe(false);
  });

  it("refuses a meeting time that isn't a date", () => {
    expect(parsePlanInput({ meet_at: "half eight" }).ok).toBe(false);
  });
});

describe("who edits a plan", () => {
  const input: PlanInput = {
    leader_member_id: ID_B,
    backmarker_member_id: ID_B,
    meet_at: null,
    meet_point: "Euston",
    transport: null,
    kit_list: [],
    route_url: null,
    booking_url: null,
    notes: null,
  };

  it("lets walk leaders and committee write plans, not ordinary members", () => {
    expect(canEditPlan(leader)).toBe(true);
    expect(canEditPlan(committee)).toBe(true);
    expect(canEditPlan(member)).toBe(false);
  });

  it("keeps the stored leader and backmarker when a walk leader saves", () => {
    const merged = mergePlanForEditor(leader, input, { leader_member_id: ID_A, backmarker_member_id: null });
    expect(merged.leader_member_id).toBe(ID_A);
    expect(merged.backmarker_member_id).toBeNull();
    expect(merged.meet_point).toBe("Euston");
  });

  it("lets committee assign the leader and backmarker", () => {
    expect(mergePlanForEditor(committee, input, { leader_member_id: ID_A, backmarker_member_id: null })).toEqual(input);
  });
});
