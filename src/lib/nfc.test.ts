import { describe, expect, it } from "vitest";
import { createDebouncer, formatUid, nfcSupport, startScanning } from "./nfc";

describe("formatUid", () => {
  const UID = "04:A1:2B:3C:4D:5E:6F";

  it("formats byte arrays", () => {
    expect(formatUid([0x04, 0xa1, 0x2b, 0x3c, 0x4d, 0x5e, 0x6f])).toBe(UID);
    expect(formatUid(new Uint8Array([4, 161, 43, 60, 77, 94, 111]))).toBe(UID);
  });

  it("accepts Java's signed bytes", () => {
    expect(formatUid([4, -95, 43, 60, 77, 94, 111])).toBe(UID);
  });

  it("accepts hex strings with or without separators", () => {
    expect(formatUid("04:a1:2b:3c:4d:5e:6f")).toBe(UID); // Web NFC serialNumber
    expect(formatUid("04A12B3C4D5E6F")).toBe(UID);
    expect(formatUid("04-a1-2b-3c-4d-5e-6f")).toBe(UID);
    expect(formatUid(" 04 A1 2B 3C 4D 5E 6F ")).toBe(UID);
    expect(formatUid("0x04a12b3c4d5e6f")).toBe(UID);
    expect(formatUid("4:a1:2b:3c:4d:5e:6f")).toBe(UID);
  });

  it("allows 4 to 10 bytes", () => {
    expect(formatUid([1, 2, 3, 4])).toBe("01:02:03:04");
    expect(formatUid(new Array(10).fill(255))).toBe(new Array(10).fill("FF").join(":"));
    expect(formatUid([1, 2, 3])).toBeNull();
    expect(formatUid(new Array(11).fill(1))).toBeNull();
  });

  it("rejects junk", () => {
    expect(formatUid("")).toBeNull();
    expect(formatUid("04A12B3C4D5E6")).toBeNull(); // odd length
    expect(formatUid("04:G1:2B:3C")).toBeNull();
    expect(formatUid("04:A12:2B:3C")).toBeNull();
    expect(formatUid([4, 256, 1, 2])).toBeNull();
    expect(formatUid([4, 1.5, 1, 2])).toBeNull();
    expect(formatUid([4, Number.NaN, 1, 2])).toBeNull();
  });
});

describe("createDebouncer", () => {
  function clock() {
    let t = 0;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  }

  it("drops repeats of a UID inside the window", () => {
    const c = clock();
    const accept = createDebouncer(2500, c.now);
    expect(accept("A")).toBe(true);
    c.advance(1000);
    expect(accept("A")).toBe(false);
    c.advance(1499);
    expect(accept("A")).toBe(false);
    c.advance(1);
    expect(accept("A")).toBe(true);
  });

  it("measures the window from the last accepted read, not the last repeat", () => {
    const c = clock();
    const accept = createDebouncer(2500, c.now);
    accept("A");
    for (let i = 0; i < 4; i++) {
      c.advance(500); // a tag held against the phone keeps firing
      expect(accept("A")).toBe(false);
    }
    c.advance(500);
    // 2500ms after the first accept: a fresh read, despite the repeats.
    expect(accept("A")).toBe(true);
  });

  it("tracks UIDs independently", () => {
    const c = clock();
    const accept = createDebouncer(2500, c.now);
    expect(accept("A")).toBe(true);
    expect(accept("B")).toBe(true);
    c.advance(100);
    expect(accept("A")).toBe(false);
    expect(accept("B")).toBe(false);
    expect(accept("C")).toBe(true);
  });

  it("with a zero window accepts everything", () => {
    const accept = createDebouncer(0, () => 0);
    expect(accept("A")).toBe(true);
    expect(accept("A")).toBe(true);
  });
});

describe("outside a browser", () => {
  it("reports no support and fails a scan in plain words", async () => {
    expect(await nfcSupport()).toBe("none");
    const errors: string[] = [];
    const session = await startScanning({ onTag: () => {}, onError: (m) => errors.push(m) });
    expect(errors).toEqual(["This device can't read NFC tags."]);
    await expect(session.stop()).resolves.toBeUndefined();
  });
});
