import { NextResponse } from "next/server";
import { getToolboxLoginUrl } from "@/lib/toolbox";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || requestUrl.origin).replace(/\/$/, "");
  const returnTo = requestUrl.searchParams.get("return_to") || `${appUrl}/auth/callback`;
  return NextResponse.redirect(getToolboxLoginUrl(returnTo));
}
