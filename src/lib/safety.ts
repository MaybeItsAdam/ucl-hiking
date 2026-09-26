import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/**
 * A member's emergency details: their own phone, who to call, and anything a
 * leader should know medically. Special-category data under UK GDPR, so:
 *
 * - opt-in, entered and deleted by the member themselves;
 * - encrypted here (AES-256-GCM under SAFETY_DATA_KEY) so the database, its
 *   backups and anyone reading them hold only ciphertext;
 * - readable only by a walk's leader or backmarker, only for members on that
 *   walk, and only from a day before it until a day after (canViewSafety);
 * - every read is written to the audit log.
 */
export interface SafetyDetails {
  phone: string | null;
  contact_name: string | null;
  contact_relation: string | null;
  contact_phone: string | null;
  medical_notes: string | null;
}

const EMPTY: SafetyDetails = {
  phone: null,
  contact_name: null,
  contact_relation: null,
  contact_phone: null,
  medical_notes: null,
};

/** A day either side of the walk: the leader prepares the night before and may need to call after. */
export const SAFETY_WINDOW_MS = 24 * 60 * 60 * 1000;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

/** Digits, spaces, +, (), - only: a phone number the `tel:` link will dial. */
export function cleanPhone(value: unknown): string | null | "invalid" {
  const raw = text(value, 40);
  if (!raw) return null;
  if (!/^[+()\d\s-]{6,}$/.test(raw) || (raw.match(/\d/g) ?? []).length < 6) return "invalid";
  return raw.replace(/\s+/g, " ");
}

export function parseSafetyInput(body: unknown): { ok: true; details: SafetyDetails } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Send your details as JSON." };
  const b = body as Record<string, unknown>;
  const phone = cleanPhone(b.phone);
  const contactPhone = cleanPhone(b.contact_phone);
  if (phone === "invalid") return { ok: false, error: "Your phone number doesn't look right." };
  if (contactPhone === "invalid") return { ok: false, error: "Your contact's phone number doesn't look right." };
  const details: SafetyDetails = {
    phone,
    contact_name: text(b.contact_name, 100),
    contact_relation: text(b.contact_relation, 60),
    contact_phone: contactPhone,
    medical_notes: text(b.medical_notes, 1000),
  };
  if (details.contact_name && !details.contact_phone) {
    return { ok: false, error: "Add a phone number for your emergency contact." };
  }
  return { ok: true, details };
}

export function hasSafetyDetails(details: SafetyDetails): boolean {
  return Object.values(details).some(Boolean);
}

export interface SafetyViewContext {
  viewerId: string;
  leaderId: string | null;
  backmarkerId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  attendee: { member_id: string | null; removed: boolean };
  now?: Date;
}

/**
 * The only rule for reading someone's safety details. Committee rank alone is
 * not enough: you must be leading or backmarking this walk, they must be on it,
 * and it must be within a day of the walk.
 */
export function canViewSafety(ctx: SafetyViewContext): boolean {
  const { viewerId, leaderId, backmarkerId, startsAt, endsAt, attendee } = ctx;
  if (!attendee.member_id || attendee.removed || !startsAt) return false;
  if (viewerId !== leaderId && viewerId !== backmarkerId) return false;
  const now = (ctx.now ?? new Date()).getTime();
  const opens = new Date(startsAt).getTime() - SAFETY_WINDOW_MS;
  const closes = new Date(endsAt ?? startsAt).getTime() + SAFETY_WINDOW_MS;
  return now >= opens && now <= closes;
}

function key(): Buffer {
  const raw = process.env.SAFETY_DATA_KEY;
  if (!raw) throw new Error("SAFETY_DATA_KEY is not set");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32) throw new Error("SAFETY_DATA_KEY must be 32 bytes, base64-encoded");
  return bytes;
}

export function safetyConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/** v1.<iv>.<tag>.<ciphertext>, each base64url. The version leaves room to rotate the key. */
export function encryptSafety(details: SafetyDetails): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(details), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptSafety(payload: string): SafetyDetails {
  const [version, iv, tag, body] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unrecognised safety payload");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const json = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  return { ...EMPTY, ...(JSON.parse(json) as Partial<SafetyDetails>) };
}

export async function loadSafety(memberIds: string[]): Promise<Map<string, SafetyDetails>> {
  const out = new Map<string, SafetyDetails>();
  if (!memberIds.length || !isSupabaseConfigured() || !safetyConfigured()) return out;
  const { data, error } = await getSupabaseAdmin().from("member_safety").select("member_id, payload_enc").in("member_id", memberIds);
  if (error) return out;
  for (const row of data ?? []) {
    try {
      out.set(row.member_id, decryptSafety(row.payload_enc));
    } catch (e) {
      console.error(`[safety] could not decrypt details for ${row.member_id}: ${(e as Error).message}`);
    }
  }
  return out;
}

export async function saveSafety(memberId: string, details: SafetyDetails) {
  const supabase = getSupabaseAdmin();
  if (!hasSafetyDetails(details)) return supabase.from("member_safety").delete().eq("member_id", memberId);
  return supabase
    .from("member_safety")
    .upsert({ member_id: memberId, payload_enc: encryptSafety(details) }, { onConflict: "member_id" });
}

export async function deleteSafety(memberId: string) {
  return getSupabaseAdmin().from("member_safety").delete().eq("member_id", memberId);
}
