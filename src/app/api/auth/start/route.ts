import { NextResponse } from "next/server";
import { getToolboxLoginUrl } from "@/lib/toolbox";
import { authCallbackUrl } from "@/lib/authCallback";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const callback = authCallbackUrl(requestUrl);
  if (!callback) return NextResponse.json({ error: "Invalid callback" }, { status: 400 });
  return NextResponse.redirect(getToolboxLoginUrl(callback));
}
