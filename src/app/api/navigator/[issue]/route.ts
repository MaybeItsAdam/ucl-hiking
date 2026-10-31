import { NextResponse } from "next/server";
import { findNavigatorIssue, NAVIGATOR_PDF_HOSTS } from "@/lib/navigator";
import { getCurrentMember } from "@/lib/session";

type Params = { params: Promise<{ issue: string }> };

const RANGE = /^bytes=\d*-\d*$/;
// Passed through from Drive. Content-Encoding is deliberately not among them: the
// body is relayed as bytes, and pdf.js turns range requests off if it sees one.
const PASS_THROUGH = ["content-length", "content-range", "last-modified", "etag"];

/**
 * A Navigator issue's PDF, relayed from Google Drive so the reader can load it
 * from this origin (Drive sends no CORS headers). Members only, and only the
 * issues in src/lib/navigator.ts: the route takes an issue number, never a URL.
 *
 * Range requests go straight through, so pdf.js fetches the pages being read
 * rather than all 60-odd MB of a photo-heavy issue up front.
 */
export async function GET(request: Request, { params }: Params) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { issue: slug } = await params;
  const issue = findNavigatorIssue(slug);
  if (!issue) return NextResponse.json({ error: "No such issue." }, { status: 404 });
  const upstreamUrl = new URL(issue.pdfUrl);
  if (upstreamUrl.protocol !== "https:" || !NAVIGATOR_PDF_HOSTS.has(upstreamUrl.hostname)) {
    return NextResponse.json({ error: "No such issue." }, { status: 404 });
  }

  const range = request.headers.get("range");
  const upstream = await fetch(upstreamUrl, {
    headers: range && RANGE.test(range) ? { Range: range } : {},
    cache: "no-store",
    signal: request.signal,
  }).catch(() => null);
  if (!upstream || !upstream.body || (upstream.status !== 200 && upstream.status !== 206)) {
    return NextResponse.json({ error: "Couldn't fetch the magazine just now." }, { status: 502 });
  }
  // Drive answers a missing or unshared file with an HTML page, not an error status.
  if ((upstream.headers.get("content-type") ?? "").includes("text/html")) {
    await upstream.body.cancel();
    return NextResponse.json({ error: "The magazine file isn't shared publicly any more." }, { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of PASS_THROUGH) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  const filename = `The Navigator - Issue ${issue.issue} - ${issue.title}.pdf`.replace(/[^\w .,-]/g, "");
  const download = new URL(request.url).searchParams.has("download");
  headers.set("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);

  return new Response(upstream.body, { status: upstream.status, headers });
}
