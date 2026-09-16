import { NextResponse } from "next/server";
import { getToolboxLoginUrl } from "@/lib/toolbox";
import { authCallbackUrl } from "@/lib/authCallback";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo = authCallbackUrl(requestUrl, requestUrl.searchParams.get("return_to"));
  if (!returnTo) return NextResponse.json({ error: "Invalid callback" }, { status: 400 });
  return NextResponse.redirect(getToolboxLoginUrl(returnTo));
}
