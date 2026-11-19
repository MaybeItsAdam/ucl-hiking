#!/usr/bin/env node
// Tells Bing (and the other IndexNow engines) about every URL in the live
// sitemap. Run after a deploy that adds or changes public pages:
//   pnpm indexnow
// SITE_URL overrides the origin. The key file is public/<key>.txt.
import { readdirSync } from "node:fs";
import { join } from "node:path";

const SITE_URL = (process.env.SITE_URL || "https://www.uclhiking.org").replace(/\/+$/, "");
const keyFile = readdirSync(join(import.meta.dirname, "..", "public")).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) throw new Error("No IndexNow key file (32 hex chars + .txt) in public/");
const key = keyFile.slice(0, -4);

const sitemap = await fetch(`${SITE_URL}/sitemap.xml`);
if (!sitemap.ok) throw new Error(`sitemap.xml: HTTP ${sitemap.status}`);
const urlList = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
if (!urlList.length) throw new Error("sitemap.xml lists no URLs");

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(SITE_URL).host, key, keyLocation: `${SITE_URL}/${keyFile}`, urlList }),
});
console.log(`IndexNow: HTTP ${res.status} for ${urlList.length} URLs`);
if (!res.ok && res.status !== 202) {
  console.error(await res.text());
  process.exit(1);
}
