import { SITE_HOST, SITE_URL } from "@/lib/seo";

/**
 * What is written on a kit tag, and how to read it back. Pure: no React, no
 * plugins, so it runs in tests, on the server and in the browser alike.
 * Re-exported from kitScan.ts with the rest of the scanning logic.
 *
 * Kit is identified by its tag's factory UID, which every tag has whatever is
 * written on it. Tags stuck on before November 2026 are blank (no NDEF at all)
 * and are still found by UID alone. Tags written since also carry an NDEF
 * message, so a phone that isn't running the app's scanner makes sense of them:
 *
 *   1. URI record  https://www.uclhiking.org/kit/<item uuid>
 *      Opens the app (iOS Universal Link / Android App Link) or, without it,
 *      the public page at src/app/kit/[id]. It goes first, because iOS
 *      background reading and Android's tag dispatch act on the first record.
 *   2. Text record "UCL Hiking Club equipment · TENT-03" (language "en")
 *      For readers that just show what's on the tag.
 *
 * In-app scanning still keys on the UID; the URL is for everyone else.
 */

/** The public page for one item, and the path the app links claim. */
export const KIT_LINK_PATH = "/kit";

/** Hosts whose /kit/<id> links are ours: the canonical site, its bare domain, and the app shell's host. */
export const KIT_LINK_HOSTS: readonly string[] = Array.from(
  new Set([SITE_HOST, "www.uclhiking.org", "uclhiking.org", "ucl-hiking.vercel.app"]),
);

/** The custom scheme the app registers, used for uclhiking://kit/<id>. */
export const APP_SCHEME = "uclhiking";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for an item id (equipment_items.id is a uuid). */
export function isItemId(value: string): boolean {
  return UUID.test(value);
}

/** https://www.uclhiking.org/kit/<id>, the URL written on a tag. */
export function kitItemUrl(itemId: string, origin: string = SITE_URL): string {
  return `${origin.replace(/\/+$/, "")}${KIT_LINK_PATH}/${itemId.toLowerCase()}`;
}

/** uclhiking://kit/<id>: opens the installed app from a web page. */
export function kitAppUrl(itemId: string): string {
  return `${APP_SCHEME}://kit/${itemId.toLowerCase()}`;
}

/**
 * The item id in a kit link, or null if it isn't one. Takes an https
 * /kit/<uuid> on one of KIT_LINK_HOSTS or `extraHosts` (http too for those
 * extra hosts and localhost), or uclhiking://kit/<uuid>. A trailing slash,
 * query or hash is fine. Ids come back lowercase.
 */
export function parseKitLink(raw: string, extraHosts: readonly string[] = []): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  let path: string;
  if (url.protocol === `${APP_SCHEME}:`) {
    // uclhiking://kit/<id>: "kit" is the host, the id is the path.
    if (url.hostname.toLowerCase() !== "kit") return null;
    path = `${KIT_LINK_PATH}${url.pathname}`;
  } else {
    const host = url.hostname.toLowerCase();
    const extra = extraHosts.map((h) => h.toLowerCase());
    const known = KIT_LINK_HOSTS.includes(host) || extra.includes(host) || extra.includes(url.host.toLowerCase());
    if (!known) return null;
    const insecureOk = host === "localhost" || extra.includes(host) || extra.includes(url.host.toLowerCase());
    if (url.protocol !== "https:" && !(url.protocol === "http:" && insecureOk)) return null;
    path = url.pathname;
  }
  const match = path.match(/^\/kit\/([^/]+)\/?$/i);
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return isItemId(id) ? id.toLowerCase() : null;
}

/** "UCL Hiking Club equipment · TENT-03", the text record (the id when there's no asset code). */
export function kitTagText(item: { id: string; asset_code?: string | null }): string {
  return `UCL Hiking Club equipment · ${item.asset_code?.trim() || item.id}`;
}

/** One NDEF record as @capgo/capacitor-nfc and the iOS HikingNfc plugin take it: plain byte arrays. */
export interface NdefRecordBytes {
  /** Type Name Format: 1 is NFC Forum well-known. */
  tnf: number;
  type: number[];
  id: number[];
  payload: number[];
}

const TNF_WELL_KNOWN = 0x01;
const RTD_URI = 0x55; // "U"
const RTD_TEXT = 0x54; // "T"

/** NFC Forum URI RTD abbreviations, longest first so the best one wins. */
const URI_PREFIXES: [number, string][] = [
  [0x02, "https://www."],
  [0x01, "http://www."],
  [0x04, "https://"],
  [0x03, "http://"],
];

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/** A URI record's payload: one abbreviation byte, then the rest of the URI. */
export function encodeUriPayload(uri: string): number[] {
  const hit = URI_PREFIXES.find(([, prefix]) => uri.toLowerCase().startsWith(prefix));
  return hit ? [hit[0], ...utf8(uri.slice(hit[1].length))] : [0x00, ...utf8(uri)];
}

/** The URI in a URI record's payload (the inverse of encodeUriPayload), or null. */
export function decodeUriPayload(payload: ArrayLike<number>): string | null {
  if (!payload.length) return null;
  const bytes = Array.from(payload, (b) => b & 0xff);
  const code = bytes[0];
  const prefix = code === 0 ? "" : URI_PREFIXES.find(([c]) => c === code)?.[1];
  if (prefix === undefined) return null;
  return prefix + new TextDecoder().decode(Uint8Array.from(bytes.slice(1)));
}

/** A Text record's payload: status byte (UTF-8, language length), language, text. */
export function encodeTextPayload(text: string, lang = "en"): number[] {
  const langBytes = utf8(lang);
  return [langBytes.length & 0x3f, ...langBytes, ...utf8(text)];
}

/** The text in a Text record's payload, or null. */
export function decodeTextPayload(payload: ArrayLike<number>): string | null {
  if (!payload.length) return null;
  const bytes = Array.from(payload, (b) => b & 0xff);
  const status = bytes[0];
  const body = Uint8Array.from(bytes.slice(1 + (status & 0x3f)));
  return new TextDecoder(status & 0x80 ? "utf-16" : "utf-8").decode(body);
}

type TagItem = { id: string; asset_code?: string | null };

/**
 * The NDEF message for an item's tag, for the native plugins: its URL, then a
 * line of text. The text is left off when both wouldn't fit on an NTAG213 (a
 * very long asset code); the URL always goes on.
 */
export function kitTagRecords(item: TagItem, origin: string = SITE_URL): NdefRecordBytes[] {
  const uri: NdefRecordBytes = {
    tnf: TNF_WELL_KNOWN,
    type: [RTD_URI],
    id: [],
    payload: encodeUriPayload(kitItemUrl(item.id, origin)),
  };
  const text: NdefRecordBytes = { tnf: TNF_WELL_KNOWN, type: [RTD_TEXT], id: [], payload: encodeTextPayload(kitTagText(item)) };
  return ndefMessageSize([uri, text]) <= NTAG213_NDEF_CAPACITY ? [uri, text] : [uri];
}

/** The same message for Web NFC's NDEFReader.write(). */
export function kitTagWebMessage(item: TagItem, origin: string = SITE_URL) {
  const withText = kitTagRecords(item, origin).length > 1;
  return {
    records: [
      { recordType: "url", data: kitItemUrl(item.id, origin) },
      ...(withText ? [{ recordType: "text", lang: "en", encoding: "utf-8", data: kitTagText(item) }] : []),
    ],
  };
}

/** Bytes an NDEF message of short records takes (each payload under 256 bytes). */
export function ndefMessageSize(records: NdefRecordBytes[]): number {
  return records.reduce((n, r) => n + 3 + (r.id.length ? 1 + r.id.length : 0) + r.type.length + r.payload.length, 0);
}

/**
 * Room for an NDEF message on an NTAG213: 144 bytes of user memory, less the
 * NDEF TLV's two-byte header and one-byte terminator.
 */
export const NTAG213_NDEF_CAPACITY = 141;

/** A record as Web NFC (recordType, data) or the capgo plugin (tnf, type, payload) reads it. */
type ReadRecord = { recordType?: string; data?: unknown } & Partial<NdefRecordBytes>;

/**
 * The item a tag's NDEF records point at (Web NFC's records, or the capgo
 * plugin's ndefMessage): the id in its kit URL. Null for a blank tag, a tag
 * from before November 2026 (UID only: look it up by UID as ever) or a tag
 * that isn't ours.
 */
export function itemIdFromRecords(records: readonly ReadRecord[] | null | undefined): string | null {
  for (const record of records ?? []) {
    let uri: string | null = null;
    if (record.recordType !== undefined) {
      if (record.recordType === "url" || record.recordType === "absolute-url") {
        const data = record.data;
        if (typeof data === "string") uri = data;
        else if (data instanceof DataView) uri = new TextDecoder().decode(data);
      }
    } else if (record.tnf === TNF_WELL_KNOWN && record.type?.length === 1 && record.type[0] === RTD_URI) {
      uri = decodeUriPayload(record.payload ?? []);
    }
    const id = uri ? parseKitLink(uri) : null;
    if (id) return id;
  }
  return null;
}
