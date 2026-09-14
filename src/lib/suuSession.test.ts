import { describe, expect, it } from "vitest";
import { classifySuProbe, DEFAULT_SU_COOKIE_NAME, suCookieHeader, suCookieHeaderFromAuthState } from "./suuSession";

describe("suCookieHeader", () => {
  it("accepts name=value, several pairs, or a bare value", () => {
    expect(suCookieHeader(" SSESSabc=value123 ")).toBe("SSESSabc=value123");
    expect(suCookieHeader("a=1; b=2")).toBe("a=1; b=2");
    expect(suCookieHeader("to2j6gv0iti5lnqlne1kbslv6t")).toBe(`${DEFAULT_SU_COOKIE_NAME}=to2j6gv0iti5lnqlne1kbslv6t`);
  });

  it("refuses header injection and junk", () => {
    expect(suCookieHeader("SSESSabc=v\r\nX-Evil: 1")).toBeNull();
    expect(suCookieHeader("=value")).toBeNull();
    expect(suCookieHeader("short")).toBeNull();
    expect(suCookieHeader("")).toBeNull();
  });
});

describe("suCookieHeaderFromAuthState", () => {
  const state = { cookies: [{ name: "SSESSabc", value: "v", domain: ".studentsunionucl.org" }, { name: "x", value: "y", domain: "example.com" }] };

  it("reads SU cookies from raw or base64 storage state", () => {
    expect(suCookieHeaderFromAuthState(JSON.stringify(state))).toBe("SSESSabc=v");
    expect(suCookieHeaderFromAuthState(Buffer.from(JSON.stringify(state)).toString("base64"))).toBe("SSESSabc=v");
  });

  it("returns null without SU cookies", () => {
    expect(suCookieHeaderFromAuthState("{}")).toBeNull();
    expect(suCookieHeaderFromAuthState("not state")).toBeNull();
  });
});

describe("classifySuProbe", () => {
  it("reads the /user redirect", () => {
    expect(classifySuProbe(302, "https://studentsunionucl.org/user/526328").status).toBe("active");
    expect(classifySuProbe(302, "/user/login").status).toBe("expired");
  });

  it("never calls a block expired", () => {
    expect(classifySuProbe(403, null).status).toBe("unknown");
    expect(classifySuProbe(302, "/elsewhere").status).toBe("unknown");
  });
});
