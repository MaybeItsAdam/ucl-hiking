import { describe, expect, it } from "vitest";
import { authCallbackUrl, isNativeAuthCallback } from "./authCallback";

describe("sign-in callback origin", () => {
  it("returns users to whichever hiking domain started sign-in", () => {
    expect(authCallbackUrl(new URL("https://ucl-hiking.vercel.app/api/auth/start")))
      .toBe("https://ucl-hiking.vercel.app/auth/callback");
    expect(authCallbackUrl(new URL("https://uclhiking.org/api/auth/start")))
      .toBe("https://uclhiking.org/auth/callback");
  });

  it("allows the native callback on the same origin", () => {
    const request = new URL("https://uclhiking.org/api/auth/entra");
    expect(authCallbackUrl(request, "https://uclhiking.org/auth/callback?native=1"))
      .toBe("https://uclhiking.org/auth/callback?native=1");
  });

  it("rejects another site or a different callback path", () => {
    const request = new URL("https://uclhiking.org/api/auth/entra");
    expect(authCallbackUrl(request, "https://ucl-hiking.vercel.app/auth/callback"))
      .toBeNull();
    expect(authCallbackUrl(request, "https://uclhiking.org/portal"))
      .toBeNull();
    expect(authCallbackUrl(request, "https://uclhiking.org/auth/callback?next=https://other.example"))
      .toBeNull();
    expect(authCallbackUrl(request, "https://uclhiking.org/auth/callback?native=1&native=0"))
      .toBeNull();
  });

  it("recognises the native callback before its URL is cleaned up", () => {
    expect(isNativeAuthCallback(new URL("https://uclhiking.org/auth/callback?native=1#token=value"))).toBe(true);
    expect(isNativeAuthCallback(new URL("https://uclhiking.org/auth/callback"))).toBe(false);
  });
});
