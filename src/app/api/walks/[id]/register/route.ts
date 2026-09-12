import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/session";
import { cancelWalkRegistration, registerForWalk } from "@/lib/walks";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized: Please sign in to book walks" }, { status: 401 });
  }

  const result = await registerForWalk(member, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    status: result.status,
    message:
      result.status === "confirmed"
        ? "Your place on this walk is confirmed!"
        : "Walk is currently at capacity. You have been added to the waitlist.",
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await cancelWalkRegistration(member, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    message: "Your booking has been cancelled.",
    waitlistPromoted: result.waitlistPromoted,
  });
}
