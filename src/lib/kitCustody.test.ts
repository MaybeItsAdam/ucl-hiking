import { describe, expect, it } from "vitest";
import {
  canRecordHandover,
  canTransitionRequest,
  holdsStock,
  mayHold,
  normalizeRestriction,
  parseBookingInput,
  parsePickupTime,
  restrictionError,
  restrictionLabel,
  restrictionPreset,
} from "./kitCustody";

const owner = { isOwner: true, isHandler: false, isPrincipal: false };
const committee = { isOwner: false, isHandler: true, isPrincipal: false };
const principal = { isOwner: false, isHandler: true, isPrincipal: true };
const stranger = { isOwner: false, isHandler: false, isPrincipal: false };

describe("canTransitionRequest: request → booking → out → back", () => {
  it("lets the committee book a pickup, move it, and hand the kit over", () => {
    expect(canTransitionRequest("pending", "booked", committee)).toBe(true);
    expect(canTransitionRequest("booked", "booked", committee)).toBe(true);
    expect(canTransitionRequest("booked", "approved", committee)).toBe(true);
    expect(canTransitionRequest("approved", "returned", committee)).toBe(true);
  });

  it("lets the committee decline a request or a booking", () => {
    expect(canTransitionRequest("pending", "rejected", committee)).toBe(true);
    expect(canTransitionRequest("booked", "rejected", committee)).toBe(true);
  });

  it("lets the member withdraw until the kit is in their hands", () => {
    expect(canTransitionRequest("pending", "cancelled", owner)).toBe(true);
    expect(canTransitionRequest("booked", "cancelled", owner)).toBe(true);
    expect(canTransitionRequest("approved", "cancelled", owner)).toBe(false);
    expect(canTransitionRequest("approved", "returned", owner)).toBe(false);
  });

  it("never lets a member book or hand over their own kit", () => {
    expect(canTransitionRequest("pending", "booked", owner)).toBe(false);
    expect(canTransitionRequest("booked", "approved", owner)).toBe(false);
    expect(canTransitionRequest("pending", "booked", stranger)).toBe(false);
  });

  it("keeps writing off a loan that is out for principals", () => {
    expect(canTransitionRequest("approved", "cancelled", committee)).toBe(false);
    expect(canTransitionRequest("approved", "cancelled", principal)).toBe(true);
  });

  it("never reopens a closed request", () => {
    for (const from of ["returned", "cancelled", "rejected"] as const) {
      for (const to of ["booked", "approved", "rejected", "returned", "cancelled"] as const) {
        expect(canTransitionRequest(from, to, principal)).toBe(false);
      }
    }
    expect(canTransitionRequest("approved", "booked", principal)).toBe(false);
    expect(canTransitionRequest("approved", "approved", principal)).toBe(false);
  });

  it("holds stock while booked or out", () => {
    expect(holdsStock("booked")).toBe(true);
    expect(holdsStock("approved")).toBe(true);
    expect(holdsStock("pending")).toBe(false);
    expect(holdsStock("returned")).toBe(false);
  });
});

describe("restricted kit", () => {
  const principals = ["principal", "admin"] as const;

  it("lets anyone hold unrestricted kit", () => {
    expect(mayHold(null, null)).toBe(true);
    expect(mayHold(undefined, "committee")).toBe(true);
    expect(mayHold([], null)).toBe(true);
  });

  it("keeps principal-only kit (the drone) to principals and admins", () => {
    expect(mayHold(principals, "principal")).toBe(true);
    expect(mayHold(principals, "admin")).toBe(true);
    expect(mayHold(principals, "committee")).toBe(false);
    expect(mayHold(principals, null)).toBe(false);
  });

  it("normalises what's stored or sent", () => {
    expect(normalizeRestriction(["admin", "principal", "admin"])).toEqual(["principal", "admin"]);
    expect(normalizeRestriction("principals")).toEqual(["principal", "admin"]);
    expect(normalizeRestriction("anyone")).toBeNull();
    expect(normalizeRestriction("Principal, Admin")).toEqual(["principal", "admin"]);
    expect(normalizeRestriction(["treasurer"])).toBeNull();
    expect(normalizeRestriction(null)).toBeNull();
  });

  it("names it in plain words", () => {
    expect(restrictionLabel(principals)).toBe("Principals and admins only");
    expect(restrictionLabel(["committee", "principal", "admin"])).toBe("Committee only");
    expect(restrictionLabel(null)).toBeNull();
    expect(restrictionError("Drone", principals)).toBe("Drone is principals and admins only. Ask a principal if you need it.");
    expect(restrictionError("Drone", principals, "Sam")).toBe("Drone is principals and admins only, and Sam can't take it out.");
  });

  it("maps a stored restriction back to the form's choice", () => {
    expect(restrictionPreset(null)).toBe("anyone");
    expect(restrictionPreset(["admin", "principal"])).toBe("principals");
    expect(restrictionPreset(["admin"])).toBe("custom");
  });
});

describe("booking a pickup", () => {
  const NOW = new Date("2026-11-19T12:00:00Z");

  it("reads a datetime-local value as London time", () => {
    // November: GMT.
    expect(parsePickupTime("2026-11-21T18:30")).toBe("2026-11-21T18:30:00.000Z");
    // July: BST, an hour ahead.
    expect(parsePickupTime("2026-07-01T18:30")).toBe("2026-07-01T17:30:00.000Z");
    expect(parsePickupTime("2026-11-21T18:30:00Z")).toBe("2026-11-21T18:30:00.000Z");
    expect(parsePickupTime("next friday")).toBeNull();
  });

  it("needs a time, and keeps the place and who they're meeting optional", () => {
    expect(parseBookingInput({}, NOW).ok).toBe(false);
    const parsed = parseBookingInput({ pickupAt: "2026-11-21T18:30", pickupLocation: "  Main quad " }, NOW);
    expect(parsed).toEqual({
      ok: true,
      input: { pickupAt: "2026-11-21T18:30:00.000Z", pickupLocation: "Main quad", pickupWithId: null },
    });
  });

  it("refuses a time long gone or a year out, and a bad member id", () => {
    expect(parseBookingInput({ pickupAt: "2026-11-01T18:30" }, NOW).ok).toBe(false);
    expect(parseBookingInput({ pickupAt: "2028-01-01T18:30" }, NOW).ok).toBe(false);
    expect(parseBookingInput({ pickupAt: "2026-11-21T18:30", pickupWithId: "sam" }, NOW).ok).toBe(false);
  });
});

describe("canRecordHandover: who confirms a change of hands", () => {
  const A = "00000000-0000-4000-8000-00000000000a";
  const B = "00000000-0000-4000-8000-00000000000b";
  const C = "00000000-0000-4000-8000-00000000000c";
  const withA = { status: "on_loan", holder_member_id: A };

  it("lets the receiver confirm by scanning it", () => {
    expect(canRecordHandover(withA, { id: B, handlesKit: false }, B)).toEqual({ ok: true });
  });

  it("doesn't let the giver push it onto someone else", () => {
    const refused = canRecordHandover(withA, { id: A, handlesKit: false }, B);
    expect(refused).toMatchObject({ ok: false, status: 403 });
  });

  it("lets a committee member record any handover", () => {
    expect(canRecordHandover(withA, { id: C, handlesKit: true }, B)).toEqual({ ok: true });
  });

  it("refuses kit in storage, and a handover to whoever already has it", () => {
    expect(canRecordHandover({ status: "available", holder_member_id: null }, { id: B, handlesKit: false }, B)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(canRecordHandover(withA, { id: A, handlesKit: false }, A)).toMatchObject({ ok: false, status: 409 });
  });
});
