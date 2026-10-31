import { NextResponse } from "next/server";
import { findNavigatorIssue, NAVIGATOR_PDF_HOSTS, navigatorVersion } from "@/lib/navigator";
import { parseByteRange } from "@/lib/navigatorRange";
import { getCurrentMember } from "@/lib/session";

type Params = { params: Promise<{ issue: string }> };

const RANGE = /^bytes=\d*-\d*$/;
// Passed through from Drive. Content-Encoding is deliberately not among them: the
// body is relayed as bytes, and pdf.js turns range requests off if it sees one.
// Drive sends no ETag, so the route makes its own from the file's id and size
// (navigatorVersion), and ignores any Drive might start sending.
const PASS_THROUGH = ["content-length", "content-range", "last-modified"];
// A day: the file behind an issue changes only when the issue list does, and
// then its ETag (and the reader's cache keys) change with it.
const CACHE_CONTROL = "private, max-age=86400";

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

  // A strong validator: the same bytes for as long as the issue reads the same file.
  const etag = `"${navigatorVersion(issue)}"`;
  const range = request.headers.get("range");
  const ifNoneMatch = request.headers.get("if-none-match");
  if (!range && ifNoneMatch && ifNoneMatch.split(/\s*,\s*/).some((tag) => tag === etag || tag === "*")) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": CACHE_CONTROL } });
  }
  // If-Range with another version: the copy the client holds is stale, so send it all.
  const ifRange = request.headers.get("if-range");
  const rangeOk = range && RANGE.test(range) && (!ifRange || ifRange === etag);

  const upstream = await fetch(upstreamUrl, {
    headers: rangeOk ? { Range: range } : {},
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
    "Cache-Control": CACHE_CONTROL,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of PASS_THROUGH) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  const filename = `The Navigator - Issue ${issue.issue} - ${issue.title}.pdf`.replace(/[^\w .,-]/g, "");
  const download = new URL(request.url).searchParams.has("download");
  headers.set("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);

  // Drive now and then ignores the Range and sends the whole file. Cut the
  // range out of it here, so the reader still gets the 206 it asked for.
  const total = Number(upstream.headers.get("content-length"));
  const wanted = rangeOk && upstream.status === 200 && total > 0 ? parseByteRange(range, total) : null;
  if (wanted) {
    const [begin, end] = wanted;
    headers.set("Content-Range", `bytes ${begin}-${end - 1}/${total}`);
    headers.set("Content-Length", String(end - begin));
    return new Response(slice(upstream.body, begin, end), { status: 206, headers });
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}

/** The bytes [begin, end) of a stream; stops reading the source once past them. */
function slice(body: ReadableStream<Uint8Array>, begin: number, end: number): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return controller.close();
        const from = offset;
        offset += value.byteLength;
        if (offset <= begin) continue;
        controller.enqueue(value.subarray(Math.max(0, begin - from), Math.min(value.byteLength, end - from)));
        if (offset >= end) {
          await reader.cancel().catch(() => {});
          return controller.close();
        }
        return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
