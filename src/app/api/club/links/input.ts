import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { normalizeDestination, normalizeLinkPath, pointsAtItself } from "@/lib/clubLinks";
import { getCurrentMember } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase";

/** The signed-in committee member, or the response refusing everyone else. */
export async function committeeOnly() {
  const member = await getCurrentMember();
  if (!member) return { refused: NextResponse.json({ error: "Sign in first." }, { status: 401 }) };
  if (!can(profileOf(member), "manage_club")) return { refused: NextResponse.json({ error: "Committee only." }, { status: 403 }) };
  if (!isSupabaseConfigured()) return { refused: NextResponse.json({ error: "Links need the database." }, { status: 503 }) };
  return { member };
}

/** A link as sent from the Links page, checked and normalised. */
export async function readLink(request: Request): Promise<{ path: string; destination: string; note: string } | { error: string }> {
  let body: { path?: unknown; destination?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return { error: "Send it as JSON." };
  }
  const path = normalizeLinkPath(typeof body.path === "string" ? body.path : "");
  if ("error" in path) return path;
  const destination = normalizeDestination(typeof body.destination === "string" ? body.destination : "");
  if ("error" in destination) return destination;
  if (pointsAtItself(path.path, destination.destination)) return { error: "A link can't point at itself." };
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";
  return { path: path.path, destination: destination.destination, note };
}

/** Postgres's unique_violation: another link already has this path. */
export const TAKEN = "23505";
