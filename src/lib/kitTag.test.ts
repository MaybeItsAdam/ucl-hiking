import { describe, expect, it } from "vitest";
import {
  decodeTextPayload,
  decodeUriPayload,
  encodeTextPayload,
  encodeUriPayload,
  itemIdFromRecords,
  kitAppUrl,
  kitItemUrl,
  kitTagRecords,
  kitTagText,
  kitTagWebMessage,
  ndefMessageSize,
  NTAG213_NDEF_CAPACITY,
  parseKitLink,
} from "./kitScan";
import { formatUid } from "./nfc";

const ID = "3f2b8c1e-7d4a-4b9e-9c21-5a6f0e8d1b42";
const ITEM = { id: ID, asset_code: "TENT-03" };

describe("kit links", () => {
  it("builds the public URL on the canonical site", () => {
    expect(kitItemUrl(ID)).toBe(`https://www.uclhiking.org/kit/${ID}`);
    expect(kitItemUrl(ID.toUpperCase(), "https://example.test/")).toBe(`https://example.test/kit/${ID}`);
    expect(kitAppUrl(ID)).toBe(`uclhiking://kit/${ID}`);
  });

  it("parses what it builds", () => {
    expect(parseKitLink(kitItemUrl(ID))).toBe(ID);
    expect(parseKitLink(kitAppUrl(ID))).toBe(ID);
  });

  it("takes the club's other hosts, a trailing slash, query, hash and any case", () => {
    expect(parseKitLink(`https://uclhiking.org/kit/${ID}`)).toBe(ID);
    expect(parseKitLink(`https://ucl-hiking.vercel.app/kit/${ID}/`)).toBe(ID);
    expect(parseKitLink(`https://WWW.UCLHIKING.ORG/kit/${ID.toUpperCase()}?from=tag#x`)).toBe(ID);
    expect(parseKitLink(`  https://www.uclhiking.org/kit/${ID}  `)).toBe(ID);
  });

  it("takes extra hosts (the app shell's own) and http only for those and localhost", () => {
    expect(parseKitLink(`https://preview.example/kit/${ID}`)).toBeNull();
    expect(parseKitLink(`https://preview.example/kit/${ID}`, ["preview.example"])).toBe(ID);
    expect(parseKitLink(`http://localhost:3000/kit/${ID}`)).toBeNull();
    expect(parseKitLink(`http://localhost:3000/kit/${ID}`, ["localhost:3000"])).toBe(ID);
    expect(parseKitLink(`http://www.uclhiking.org/kit/${ID}`)).toBeNull();
  });

  it("refuses anything that isn't a kit link", () => {
    for (const bad of [
      "",
      "not a url",
      `https://evil.example/kit/${ID}`,
      `https://www.uclhiking.org/portal/equipment`,
      `https://www.uclhiking.org/kit/TENT-03`,
      `https://www.uclhiking.org/kit/${ID}/extra`,
      `https://www.uclhiking.org/kits/${ID}`,
      `uclhiking://auth/kit/${ID}`,
      `uclhiking://kit/not-an-id`,
      `javascript:alert(1)`,
    ]) {
      expect(parseKitLink(bad), bad).toBeNull();
    }
  });
});

describe("NDEF payloads", () => {
  it("abbreviates https://www. in a URI record and reads it back", () => {
    const payload = encodeUriPayload(kitItemUrl(ID));
    expect(payload[0]).toBe(0x02);
    expect(String.fromCharCode(...payload.slice(1))).toBe(`uclhiking.org/kit/${ID}`);
    expect(decodeUriPayload(payload)).toBe(kitItemUrl(ID));
  });

  it("round-trips other prefixes, and refuses an unknown abbreviation", () => {
    for (const uri of ["https://ucl-hiking.vercel.app/kit/x", "http://localhost/kit/x", "uclhiking://kit/x"]) {
      expect(decodeUriPayload(encodeUriPayload(uri))).toBe(uri);
    }
    expect(decodeUriPayload([])).toBeNull();
    expect(decodeUriPayload([0x7f, 0x61])).toBeNull();
  });

  it("writes a UTF-8 text record with its language and reads it back", () => {
    const text = kitTagText(ITEM);
    expect(text).toBe("UCL Hiking Club equipment · TENT-03");
    const payload = encodeTextPayload(text);
    expect(payload.slice(0, 3)).toEqual([2, 0x65, 0x6e]);
    expect(decodeTextPayload(payload)).toBe(text);
    expect(kitTagText({ id: ID })).toBe(`UCL Hiking Club equipment · ${ID}`);
  });

  it("reads Java's signed bytes", () => {
    const signed = encodeTextPayload("·").map((b) => (b > 127 ? b - 256 : b));
    expect(decodeTextPayload(signed)).toBe("·");
  });
});

describe("the message on a tag", () => {
  it("is the URL first, then the text, and fits an NTAG213", () => {
    const records = kitTagRecords(ITEM);
    expect(records.map((r) => [r.tnf, r.type])).toEqual([
      [1, [0x55]],
      [1, [0x54]],
    ]);
    expect(decodeUriPayload(records[0].payload)).toBe(kitItemUrl(ID));
    expect(decodeTextPayload(records[1].payload)).toBe("UCL Hiking Club equipment · TENT-03");
    expect(ndefMessageSize(records)).toBeLessThanOrEqual(NTAG213_NDEF_CAPACITY);
  });

  it("fits the longest asset code the database allows (40 characters)", () => {
    const records = kitTagRecords({ id: ID, asset_code: "A".repeat(40) });
    expect(records).toHaveLength(2);
    expect(ndefMessageSize(records)).toBeLessThanOrEqual(NTAG213_NDEF_CAPACITY);
  });

  it("drops the text, never the URL, when both won't fit", () => {
    const origin = "https://a-much-longer-host-name-than-the-club-uses.example";
    const long = { id: ID, asset_code: "A".repeat(40) };
    const records = kitTagRecords(long, origin);
    expect(records).toHaveLength(1);
    expect(decodeUriPayload(records[0].payload)).toBe(kitItemUrl(ID, origin));
    expect(kitTagWebMessage(long, origin).records).toHaveLength(1);
  });

  it("has the same records for Web NFC", () => {
    expect(kitTagWebMessage(ITEM)).toEqual({
      records: [
        { recordType: "url", data: kitItemUrl(ID) },
        { recordType: "text", lang: "en", encoding: "utf-8", data: "UCL Hiking Club equipment · TENT-03" },
      ],
    });
  });
});

describe("reading a tag back", () => {
  it("finds the item in records written by the app (plugin bytes or Web NFC)", () => {
    expect(itemIdFromRecords(kitTagRecords(ITEM))).toBe(ID);
    expect(itemIdFromRecords(kitTagWebMessage(ITEM).records)).toBe(ID);
    const view = new DataView(new TextEncoder().encode(kitItemUrl(ID)).buffer);
    expect(itemIdFromRecords([{ recordType: "url", data: view }])).toBe(ID);
  });

  it("finds the URL whatever order the records are in", () => {
    const [uri, text] = kitTagRecords(ITEM);
    expect(itemIdFromRecords([text, uri])).toBe(ID);
  });

  it("gives null for legacy blank tags and other people's tags, which go by UID", () => {
    expect(itemIdFromRecords(null)).toBeNull();
    expect(itemIdFromRecords(undefined)).toBeNull();
    expect(itemIdFromRecords([])).toBeNull();
    expect(itemIdFromRecords([{ tnf: 1, type: [0x55], id: [], payload: encodeUriPayload("https://example.com/") }])).toBeNull();
    expect(itemIdFromRecords([{ recordType: "text", data: "hello" }])).toBeNull();
    expect(itemIdFromRecords([{ recordType: "empty" }])).toBeNull();
  });

  it("still keys legacy tags on their factory UID", () => {
    // Tags stuck on before kit links were written carry nothing but a UID.
    expect(formatUid([0x04, 0xa1, 0x2b, 0x3c, 0x4d, 0x5e, 0x6f])).toBe("04:A1:2B:3C:4D:5E:6F");
    expect(formatUid("04a12b3c4d5e6f")).toBe("04:A1:2B:3C:4D:5E:6F");
  });
});
