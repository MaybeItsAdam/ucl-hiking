import { describe, expect, it } from "vitest";
import { isRotaField, rotaCellText } from "@/lib/rota";

describe("rotaCellText", () => {
  it("keeps a slot to one line", () => {
    expect(rotaCellText("leader1", "  Niha (+)\n ")).toBe("Niha (+)");
    expect(rotaCellText("leader2", "Samuel\nD")).toBe("Samuel D");
  });

  it("writes a list one name a line as the sheet's commas", () => {
    expect(rotaCellText("shadowing", "Berkan\n\nDoruk,\n Sophia ")).toBe("Berkan, Doruk, Sophia");
    expect(rotaCellText("extraLeaders", "Val, Yifei")).toBe("Val, Yifei");
    expect(rotaCellText("extraLeaders", "")).toBe("");
  });

  it("only knows the rota's cells", () => {
    expect(isRotaField("leader6")).toBe(true);
    expect(isRotaField("shadowing")).toBe(true);
    expect(isRotaField("notes")).toBe(false);
  });
});
