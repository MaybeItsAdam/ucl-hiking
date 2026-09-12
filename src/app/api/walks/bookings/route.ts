import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/session";
import { getMemberBookings } from "@/lib/walks";

export async function GET() {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bookings = await getMemberBookings(member.id);
  return NextResponse.json({ bookings });
}
