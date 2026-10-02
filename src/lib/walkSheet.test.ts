import { describe, expect, it } from "vitest";
import {
  canSee,
  matchSuEvent,
  nameKey,
  parseLeaderCell,
  parseNumber,
  parseSheetDate,
  planningRowOf,
  readCalendar,
  readRoster,
  rosterIndex,
  sheetDate,
  visibilityFromMembership,
  walkLeaders,
  type Viewer,
  type Visibility,
} from "@/lib/walkSheet";

const committee: Viewer = { tier: "standard", isLeader: true, isCommittee: true };
const leader: Viewer = { tier: "standard", isLeader: true, isCommittee: false };
const taster: Viewer = { tier: "taster", isLeader: false, isCommittee: false };
const member: Viewer = { tier: "standard", isLeader: false, isCommittee: false };
const explorer: Viewer = { tier: "explorer", isLeader: false, isCommittee: false };
const signedOut: Viewer = { tier: null, isLeader: false, isCommittee: false };

const walk = (visibility: Visibility, published = true) => ({ published, visibility });

describe("canSee", () => {
  it("shows the committee everything, published or not", () => {
    expect(canSee(walk("committee", false), committee)).toBe(true);
    expect(canSee(walk("explorer", false), committee)).toBe(true);
  });

  it("hides an unpublished walk from everyone else", () => {
    for (const v of [leader, taster, member, explorer, signedOut]) expect(canSee(walk("public", false), v)).toBe(false);
  });

  it("climbs the membership ladder", () => {
    expect(canSee(walk("taster"), taster)).toBe(true);
    expect(canSee(walk("member"), taster)).toBe(false);
    expect(canSee(walk("explorer"), taster)).toBe(false);
    expect(canSee(walk("member"), member)).toBe(true);
    expect(canSee(walk("explorer"), member)).toBe(false);
    for (const v of ["public", "taster", "member", "explorer"] as const) expect(canSee(walk(v), explorer)).toBe(true);
  });

  it("shows a signed-out visitor only public walks", () => {
    expect(canSee(walk("public"), signedOut)).toBe(true);
    expect(canSee(walk("taster"), signedOut)).toBe(false);
  });

  it("keeps leaders-only walks to leaders and committee walks to the committee", () => {
    expect(canSee(walk("leaders"), leader)).toBe(true);
    expect(canSee(walk("leaders"), explorer)).toBe(false);
    expect(canSee(walk("committee"), leader)).toBe(false);
  });
});

describe("visibilityFromMembership", () => {
  it("reads the sheet's MEMBERSHIP values", () => {
    expect(visibilityFromMembership("All")).toBe("taster");
    expect(visibilityFromMembership("Taster")).toBe("taster");
    expect(visibilityFromMembership("Discoverer")).toBe("member");
    expect(visibilityFromMembership("Explorer")).toBe("explorer");
    expect(visibilityFromMembership("WL only")).toBe("leaders");
    expect(visibilityFromMembership("Committee")).toBe("committee");
    expect(visibilityFromMembership("")).toBe("taster");
  });
});

describe("sheet cells", () => {
  it("parses the calendar's dates", () => {
    expect(parseSheetDate("23/08/25")).toBe("2025-08-23");
    expect(parseSheetDate("3/10/26")).toBe("2026-10-03");
    expect(parseSheetDate("12/9/26")).toBe("2026-09-12");
    // A multi-day trip starts on its first date.
    expect(parseSheetDate("Sat 25/07/26 - Wed 29/07/26")).toBe("2026-07-25");
    expect(parseSheetDate("TBC")).toBeNull();
    expect(parseSheetDate(sheetDate("2026-10-03"))).toBe("2026-10-03");
    expect(sheetDate("2026-10-03")).toBe("03/10/2026");
  });

  it("parses numbers and refuses errors and dashes", () => {
    expect(parseNumber("£28.70")).toBe(28.7);
    expect(parseNumber("19.44")).toBe(19.44);
    expect(parseNumber("1,200")).toBe(1200);
    expect(parseNumber("#N/A")).toBeNull();
    expect(parseNumber("---")).toBeNull();
  });

  it("finds a hike's planning row from its name formula", () => {
    expect(planningRowOf("='Hike Planning + HTML'!A103")).toBe(103);
    expect(planningRowOf("Social 🎉: Games Night")).toBeNull();
  });
});

describe("parseLeaderCell", () => {
  const names = (cell: string) => parseLeaderCell(cell).map((m) => [m.name, m.firstAid, m.tentative]);

  it("cleans the names as the calendar writes them", () => {
    expect(names("Valentino (+)")).toEqual([["Valentino", true, false]]);
    expect(names(" Declan (+)")).toEqual([["Declan", true, false]]);
    expect(names("Wren🐦(+)")).toEqual([["Wren", true, false]]);
    expect(names("Wren (+) 🐦")).toEqual([["Wren", true, false]]);
    expect(names("Diana (+) [1a]")).toEqual([["Diana", true, false]]);
    expect(names("Diana (+, TBC)")).toEqual([["Diana", true, true]]);
    expect(names("E'Jane ")).toEqual([["E'Jane", false, false]]);
  });

  it("splits lists and drops blanks", () => {
    expect(names("Nellie (+), Linus, Kirtiradi")).toEqual([
      ["Nellie", true, false],
      ["Linus", false, false],
      ["Kirtiradi", false, false],
    ]);
    expect(names("Sibo Zhang, ")).toEqual([["Sibo Zhang", false, false]]);
  });

  it("ignores formula errors and dashes", () => {
    expect(parseLeaderCell("#VALUE!")).toEqual([]);
    expect(parseLeaderCell("---")).toEqual([]);
    expect(parseLeaderCell("")).toEqual([]);
  });
});

describe("nameKey", () => {
  it("joins up emoji and accents", () => {
    expect(nameKey("Wren🐦")).toBe(nameKey("Wren"));
    expect(nameKey("Vítek")).toBe(nameKey("Vitek"));
    expect(nameKey("E'Jane ")).toBe("ejane");
  });
});

describe("roster", () => {
  const rows = [
    ["Name (as on the calendar)", "Email", "Also written as", "First aid trained", "First aid valid until", "Active", "Notes"],
    ["Valentino", "Val.Tan@UCL.ac.uk", "Val, Valentino Tan", "TRUE", "01/09/27", "TRUE", ""],
    ["Linus", "not an email", "", "FALSE", "", "", ""],
    ["", "ghost@ucl.ac.uk"],
    ["Gone", "gone@ucl.ac.uk", "", "", "", "FALSE"],
  ];

  it("reads entries, emails, first aid and active", () => {
    const roster = readRoster(rows);
    expect(roster.map((r) => r.name)).toEqual(["Valentino", "Linus", "Gone"]);
    expect(roster[0]).toMatchObject({ row: 2, email: "val.tan@ucl.ac.uk", aliases: ["Val", "Valentino Tan"], firstAid: true, firstAidUntil: "2027-09-01", active: true });
    expect(roster[1]).toMatchObject({ email: null, firstAid: false, active: true });
    expect(roster[2].active).toBe(false);
  });

  it("finds an entry by any of its names", () => {
    const index = rosterIndex(readRoster(rows));
    expect(index.get(nameKey("Val"))?.name).toBe("Valentino");
    expect(index.get(nameKey("valentino tan"))?.name).toBe("Valentino");
    expect(index.get(nameKey("Linus"))?.row).toBe(3);
  });
});

describe("walkLeaders", () => {
  it("reads the sign-up columns when there are any", () => {
    const { leaders, shadows } = walkLeaders(
      { leader1: "Niha (+)", leader2: "Kelvin", leader3: "Diana (+, TBC)", shadowing: "Rita, Kelvin" },
      { firstAider: "Someone Else (+)" },
    );
    expect(leaders.map((m) => m.name)).toEqual(["Niha", "Kelvin"]);
    // Kelvin leads, so isn't also a shadow.
    expect(shadows.map((m) => m.name)).toEqual(["Rita"]);
  });

  it("falls back to what the main calendar shows", () => {
    const { leaders, shadows } = walkLeaders(
      {},
      { firstAider: "Valentino (+)", mainLeader2: "Slava (+)", mainExtraLeaders: "Nellie, Valentino", mainShadowing: "Sibo Zhang" },
    );
    expect(leaders.map((m) => m.name)).toEqual(["Valentino", "Slava", "Nellie"]);
    expect(shadows.map((m) => m.name)).toEqual(["Sibo Zhang"]);
  });
});

describe("matchSuEvent", () => {
  const events = [
    { suuId: "wye", title: "Hike: Wye to Canterbury (20km)", date: "2026-09-06" },
    { suuId: "fair", title: "Freshers Fair: Meet the Hiking Club", date: "2026-10-03" },
    { suuId: "seven", title: "Taster Walk (3 of 8): Sevenoaks Circular (15km)", date: "2026-10-03" },
  ];

  it("links the same day's event with a similar title", () => {
    expect(matchSuEvent({ date: "2026-09-06", title: "🥾 Hike: Wye to Canterbury (20km)" }, events)?.suuId).toBe("wye");
  });

  it("never links across dates", () => {
    expect(matchSuEvent({ date: "2026-09-07", title: "🥾 Hike: Wye to Canterbury (20km)" }, events)).toBeNull();
  });

  it("picks the right one of two events on a day", () => {
    expect(matchSuEvent({ date: "2026-10-03", title: "🌻 Taster Walk (3 of 8): Sevenoaks Circular (15km)" }, events)?.suuId).toBe("seven");
    expect(matchSuEvent({ date: "2026-10-03", title: "💼 Committee: Freshers Fair" }, events)?.suuId).toBe("fair");
  });
});

describe("readCalendar", () => {
  const header = [
    "", "DATE 🗓️", "DAY ⛅", "EVENT NAME 📝", "EVENT LEAD", "VENUE", "MEMBERSHIP 👤", "STATUS", "DISTANCE (km)", "MEETING TIME",
    "FIRST AIDER", "WALK LEADER 2", "SU EVENT LINK", "NOTES/ REMARKS",
  ];
  const rows = [
    ["Templates", "These rows are only visible to the committee"],
    ["", "", "", "Taster Hike 🌳"],
    header,
    ["Week 2", "3/10/26", "Saturday", "🌻 Taster Walk (3 of 8): Sevenoaks Circular", "KELVIN", "The Great Outdoors", "Taster", "PUBLISHED ✅", "14.67", "09:05", "Niha (+)", "Kelvin", "https://studentsunionucl.org/x", ""],
    ["", "09/10/26", "Friday", "☕Social: Board Games Night", "", "", "All", "TBC", "---", "---", "---", "---", "", "Bring games"],
    ["Week 3", "12/10/26", "Monday"],
    [],
    ["", "TBC", "TBC", "Bake Sale 🍰🍪 ???", "", "", "", "TBC"],
  ];
  const formulas = rows.map((r) => [...r]);
  formulas[3] = [...rows[3]];
  formulas[3][3] = "='Hike Planning + HTML'!A103";
  formulas[3][7] = '=IF(A1,"PUBLISHED ✅","TBC")';
  const keys = [null, null, null, "k-seven", null, null, null, null];

  it("reads only real events below the header", () => {
    const calendar = readCalendar(rows, formulas, keys)!;
    expect(calendar.layout.headerRow).toBe(2);
    expect(calendar.walks.map((w) => [w.row, w.key, w.date, w.kind, w.planningRow])).toEqual([
      [4, "k-seven", "2026-10-03", "walk", 103],
      [5, null, "2026-10-09", "social", null],
    ]);
  });

  it("keeps formulas out of the editable values and in what's shown", () => {
    const [hike, social] = readCalendar(rows, formulas, keys)!.walks;
    expect(hike.values.name).toBeUndefined();
    expect(hike.values.membership).toBe("Taster");
    expect(hike.shown.status).toBe("PUBLISHED ✅");
    expect(hike.shown.firstAider).toBe("Niha (+)");
    expect(social.values.name).toBe("☕Social: Board Games Night");
    expect(social.values.notes).toBe("Bring games");
  });

  it("gives up without a header", () => {
    expect(readCalendar([["nothing", "here"]], [], [])).toBeNull();
  });
});
