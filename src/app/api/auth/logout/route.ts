import { NextResponse } from "next/server";
import { clearRolePreviewCookie, clearSessionCookie } from "@/lib/session";

export async function POST(request: Request) {
  await clearSessionCookie();
  await clearRolePreviewCookie();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
