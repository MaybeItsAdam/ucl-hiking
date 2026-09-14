import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseServiceAccountKey, signAssertion } from "./cloudRun";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyJson = JSON.stringify({
  type: "service_account",
  project_id: "ucl-hiking-website",
  client_email: "hiking-web@ucl-hiking-website.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});

describe("parseServiceAccountKey", () => {
  it("reads raw and base64 JSON keys", () => {
    expect(parseServiceAccountKey(keyJson)?.project_id).toBe("ucl-hiking-website");
    expect(parseServiceAccountKey(Buffer.from(keyJson).toString("base64"))?.token_uri).toBe("https://oauth2.googleapis.com/token");
  });

  it("refuses anything that isn't a service account key", () => {
    expect(parseServiceAccountKey(undefined)).toBeNull();
    expect(parseServiceAccountKey('{"type":"authorized_user"}')).toBeNull();
    expect(parseServiceAccountKey("not a key")).toBeNull();
  });
});

describe("signAssertion", () => {
  it("produces a verifiable RS256 JWT for the token endpoint", () => {
    const key = parseServiceAccountKey(keyJson)!;
    const [header, claims, signature] = signAssertion(key, 1_000).split(".");
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({
      iss: key.client_email,
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_000,
      exp: 1_600,
    });
    const valid = createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, "base64url"));
    expect(valid).toBe(true);
  });
});
