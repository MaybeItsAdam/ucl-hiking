import { timingSafeEqual } from "node:crypto";
import { can, profileOf } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
export function cronBearerMatches(header: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A sync route: the cron, or committee running it by hand while signed in. */
export async function cronOrCommittee(request: Request): Promise<boolean> {
  if (cronBearerMatches(request.headers.get("authorization"))) return true;
  const member = await getCurrentMember();
  return Boolean(member && can(profileOf(member), "trigger_sync"));
}
