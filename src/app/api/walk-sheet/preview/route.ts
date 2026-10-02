import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { SheetsError } from "@/lib/googleSheets";
import { getCurrentMember } from "@/lib/session";
import { previewWalkSheet } from "@/lib/walkSheetSync";

/**
 * Committee: what a sync would read from the calendar sheets right now,
 * without tagging rows or touching the database. For checking the column
 * mapping after the sheet's layout changes.
 */
export const maxDuration = 60;

export async function GET() {
  const member = await getCurrentMember();
  if (!member || !can(profileOf(member), "manage_walks")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await previewWalkSheet());
  } catch (e) {
    return NextResponse.json({ error: e instanceof SheetsError ? e.message : String(e) }, { status: 502 });
  }
}
