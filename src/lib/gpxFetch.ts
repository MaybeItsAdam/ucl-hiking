import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { GPX_MAX_BYTES, looksLikeGpx } from "@/lib/gpx";

/**
 * Fetch a GPX file from a link a leader pasted. The server does the fetching,
 * so the link is treated as hostile: http(s) on the usual ports only, every
 * address the name resolves to must be public (checked at connect time, so a
 * DNS answer can't change between the check and the connection), a few
 * redirects at most, each checked the same way, a size cap and a time limit.
 */

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "UCLHikingClub/1.0 (+https://ucl-hiking.vercel.app; GPX route import)";

export class GpxFetchError extends Error {}

function ipv4Private(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast and reserved
  );
}

/** True for any address a server-side fetch must not reach. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ipv4Private(ip);
  if (kind !== 6) return true;
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);
  if (lower.startsWith("::ffff:")) return true;
  return (
    lower === "::" ||
    lower === "::1" ||
    /^f[cd]/.test(lower) || // unique local
    /^fe[89ab]/.test(lower) || // link-local
    lower.startsWith("ff") || // multicast
    lower.startsWith("64:ff9b:") || // NAT64
    lower.startsWith("2001:db8") ||
    lower.startsWith("::") // other v4-compatible forms
  );
}

/** A URL we'd agree to fetch, before any network: scheme, port, no credentials, no bare IPs to private ranges. */
export function checkGpxUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new GpxFetchError("That isn't a link.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new GpxFetchError("The link must start with https://.");
  if (url.username || url.password) throw new GpxFetchError("Links with a password in them can't be fetched.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new GpxFetchError("That link uses an unusual port.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new GpxFetchError("That link points somewhere private.");
  }
  if (isIP(host) && isPrivateAddress(host)) throw new GpxFetchError("That link points somewhere private.");
  return url;
}

/** DNS lookup that refuses to hand back a private address, used by the socket itself. */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      return callback(new GpxFetchError("That link points somewhere private."), "", 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

function getOnce(url: URL, deadline: number): Promise<{ status: number; location: string | null; body: Buffer | null }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.get(
      url,
      {
        lookup: safeLookup,
        headers: { "User-Agent": USER_AGENT, Accept: "application/gpx+xml, application/xml, text/xml, */*;q=0.5", "Accept-Encoding": "identity" },
        timeout: Math.max(1, deadline - Date.now()),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location ?? null, body: null });
        }
        if (status !== 200) {
          res.resume();
          return reject(new GpxFetchError(`The link answered ${status}. Is it public?`));
        }
        const declared = Number(res.headers["content-length"]);
        if (declared > GPX_MAX_BYTES) {
          res.destroy();
          return reject(new GpxFetchError("That file is over 4 MB."));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > GPX_MAX_BYTES) {
            res.destroy();
            reject(new GpxFetchError("That file is over 4 MB."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, location: null, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    const timer = setTimeout(() => req.destroy(new GpxFetchError("The link took too long to answer.")), Math.max(1, deadline - Date.now()));
    req.on("timeout", () => req.destroy(new GpxFetchError("The link took too long to answer.")));
    req.on("error", (e) => reject(e instanceof GpxFetchError ? e : new GpxFetchError("That link couldn't be reached.")));
    req.on("close", () => clearTimeout(timer));
  });
}

/** The GPX text behind a link, or a GpxFetchError that can be shown as is. */
export async function fetchGpx(raw: string): Promise<string> {
  let url = checkGpxUrl(raw);
  const deadline = Date.now() + TIMEOUT_MS;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await getOnce(url, deadline);
    if (res.body) {
      const text = res.body.toString("utf8");
      if (!looksLikeGpx(text)) {
        throw new GpxFetchError(
          "That link is a web page, not a GPX file. In OS Maps or Komoot, export the route as GPX and upload the file instead.",
        );
      }
      return text;
    }
    if (!res.location) throw new GpxFetchError("The link redirected nowhere.");
    url = checkGpxUrl(new URL(res.location, url).toString());
  }
  throw new GpxFetchError("The link redirected too many times.");
}
