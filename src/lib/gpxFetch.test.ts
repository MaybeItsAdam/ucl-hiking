import { describe, expect, it } from "vitest";
import { checkGpxUrl, isPrivateAddress } from "./gpxFetch";

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"])(
    "blocks %s",
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "151.101.1.1", "2606:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe("checkGpxUrl", () => {
  it("accepts an ordinary https link", () => {
    expect(checkGpxUrl("https://example.org/walk.gpx").hostname).toBe("example.org");
  });
  it.each([
    ["ftp://example.org/walk.gpx", /https/],
    ["file:///etc/passwd", /https/],
    ["http://localhost/walk.gpx", /private/],
    ["http://127.0.0.1/walk.gpx", /private/],
    ["http://[::1]/walk.gpx", /private/],
    ["http://169.254.169.254/latest/meta-data", /private/],
    ["https://example.org:8443/walk.gpx", /port/],
    ["https://user:pass@example.org/walk.gpx", /password/],
    ["not a url", /isn't a link/],
  ])("refuses %s", (url, message) => {
    expect(() => checkGpxUrl(url)).toThrow(message);
  });
});
