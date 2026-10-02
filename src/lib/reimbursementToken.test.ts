import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { CLAIM_TOKEN_TTL_SECONDS, signClaimToken } from "./reimbursementToken";

/**
 * The Apps Script that receives claims, run here against stand-ins for the
 * Apps Script services that behave as Google documents them (signed byte
 * arrays, padded web-safe base64), so the app's tokens are checked by the very
 * code the treasurer pastes in.
 */
const signed = (buf: Buffer) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const unsigned = (bytes: number[]) => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b)));

const Utilities = {
  Charset: { UTF_8: "UTF-8" },
  computeHmacSha256Signature: (value: string, key: string) => signed(createHmac("sha256", key).update(value, "utf8").digest()),
  base64EncodeWebSafe: (bytes: number[]) => unsigned(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
  base64DecodeWebSafe: (text: string) => {
    if (text.length % 4) throw new Error("Could not decode string.");
    return signed(Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  },
  newBlob: (bytes: number[]) => ({ getDataAsString: () => unsigned(bytes).toString("utf8") }),
};

const script = readFileSync(join(__dirname, "../../apps-script/reimbursements/Code.gs"), "utf8");
const gs: Record<string, unknown> = { Utilities };
runInNewContext(script, gs);
type Verify = (token: unknown, secret: string, now: number) => { ok: boolean; claims?: Record<string, unknown>; error?: string };
type Parse = (claim: unknown) => { ok: boolean; value?: Record<string, unknown>; error?: string };
const verify = gs.uclhApp_verifyToken as Verify;
const parseClaim = gs.uclhApp_parseClaim as Parse;

const SECRET = "c2VjcmV0LWZvci10ZXN0cw==";
const NOW = 1_790_000_000;
const who = { sub: "member-1", email: "a.walker@ucl.ac.uk", name: "Zoë Ångström", kind: "wl" as const };

describe("claim tokens", () => {
  it("are accepted by the Apps Script, claims intact (non-ASCII names too)", () => {
    const result = verify(signClaimToken(who, SECRET, NOW, "jti-1"), SECRET, NOW + 5);
    expect(result.ok).toBe(true);
    expect(result.claims).toMatchObject({ ...who, jti: "jti-1", iat: NOW, exp: NOW + CLAIM_TOKEN_TTL_SECONDS });
  });

  it("expire after ten minutes", () => {
    const token = signClaimToken(who, SECRET, NOW);
    expect(verify(token, SECRET, NOW + CLAIM_TOKEN_TTL_SECONDS).ok).toBe(true);
    expect(verify(token, SECRET, NOW + CLAIM_TOKEN_TTL_SECONDS + 1).ok).toBe(false);
  });

  it("are refused with the wrong secret or a changed claim", () => {
    const token = signClaimToken(who, SECRET, NOW);
    expect(verify(token, "another secret", NOW).ok).toBe(false);
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...who, kind: "committee", iat: NOW, exp: NOW + 600, jti: "x" })).toString("base64url");
    expect(verify(`${forged}.${sig}`, SECRET, NOW).ok).toBe(false);
    expect(verify("not a token", SECRET, NOW).ok).toBe(false);
    expect(verify(undefined, SECRET, NOW).ok).toBe(false);
  });

  it("carry no padding, so they survive being pasted anywhere", () => {
    for (let i = 0; i < 8; i++) {
      expect(signClaimToken({ ...who, name: "x".repeat(i) }, SECRET, NOW)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    }
  });
});

describe("the Apps Script's claim check", () => {
  const good = {
    event: "Seven Sisters #2",
    date: "2026-10-18",
    category: "Travel",
    description: "Train ticket",
    amount: "31.65",
    accountName: "A Walker",
    sortCode: "04-00-04",
    accountNumber: "01234567",
    notes: "",
  };

  it("keeps leading zeros and formats the sort code", () => {
    const parsed = parseClaim(good);
    expect(parsed.ok).toBe(true);
    expect(parsed.value).toMatchObject({ amount: 31.65, sortCode: "04-00-04", accountNumber: "01234567" });
  });

  it("refuses bad bank details and amounts", () => {
    expect(parseClaim({ ...good, sortCode: "12345" }).ok).toBe(false);
    expect(parseClaim({ ...good, accountNumber: "1234567" }).ok).toBe(false);
    expect(parseClaim({ ...good, amount: "0" }).ok).toBe(false);
    expect(parseClaim({ ...good, amount: "12.345" }).ok).toBe(false);
    expect(parseClaim({ ...good, amount: "2000.01" }).ok).toBe(false);
    expect(parseClaim({ ...good, category: "Beer" }).ok).toBe(false);
  });
});
