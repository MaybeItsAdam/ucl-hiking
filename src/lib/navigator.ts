/**
 * The Navigator, the club magazine ("A Magazine By the Club, For the Club").
 *
 * Every issue the app knows about lives here and nowhere else. The PDFs sit on
 * the club's Google Drive, which won't let a browser fetch them cross-origin, so
 * the reader loads them through /api/navigator/[issue] — and that route only ever
 * fetches a `pdfUrl` from this list, never a URL it was handed.
 *
 * Adding an issue: share the PDF on Drive as "anyone with the link", give its
 * file id and size in bytes to `drive()`, render page 1 to
 * public/navigator/issue-N.webp (640px wide) and add an entry. Order doesn't
 * matter; the library sorts.
 *
 * A print-resolution PDF (hundreds of MB) is too heavy to read on a phone. Make
 * a web-weight copy (Ghostscript /ebook, images at 150 dpi, linearised with
 * qpdf), share it on Drive the same way and pass it as `drive()`'s second
 * argument: the reader and the download switch to it, and "open the original"
 * keeps pointing at the full file.
 */

export type NavigatorIssue = {
  /** Issue number, as printed on the cover. Also the URL slug: /portal/navigator/2. */
  issue: number;
  /** The issue's own title, without "The Navigator". */
  title: string;
  /** Month of publication, YYYY-MM, as printed on the cover. */
  date: string;
  /** Page count, when known, so the library can show it without opening the PDF. */
  pages?: number;
  /**
   * A direct download of the PDF the app reads. The reader only ever gets it
   * through the proxy route; the native app also hands it to the system browser
   * to download, as that browser has no session to get past the proxy with.
   */
  pdfUrl: string;
  /** The size of `pdfUrl` in bytes, for "Download · 50 MB". */
  bytes?: number;
  /** Where the original lives, for "open original". */
  sourceUrl: string;
  /** Page 1, rendered, under public/. */
  cover?: string;
  /** The cover image's size, when it isn't the 640 × 828 of a US Letter page. */
  coverSize?: { width: number; height: number };
};

/** Hosts the proxy may fetch from. A belt to go with the braces of a fixed list. */
export const NAVIGATOR_PDF_HOSTS: ReadonlySet<string> = new Set(["drive.usercontent.google.com"]);

type DriveFile = { id: string; bytes: number };

/** An issue on Drive: the original, plus the lighter copy to read and download instead, if it has one. */
const drive = (original: DriveFile, webCopy: DriveFile | null = null) => {
  const read = webCopy ?? original;
  return {
    pdfUrl: `https://drive.usercontent.google.com/download?id=${read.id}&export=download&confirm=t`,
    bytes: read.bytes,
    sourceUrl: `https://drive.google.com/file/d/${original.id}/view`,
  };
};

// Issues 1 and 2 are the ones the old site linked to as /e/navigator/1 and
// /e/navigator/2 (see src/lib/redirects.ts). Titles and dates are from the covers.
export const NAVIGATOR_ISSUES: readonly NavigatorIssue[] = [
  {
    issue: 1,
    title: "Trail Mix",
    date: "2025-02",
    pages: 72,
    cover: "/navigator/issue-1.webp",
    ...drive({ id: "1uW8CImkdw_h0-RW_aUxKeByXKPQu1X02", bytes: 15_999_651 }),
  },
  {
    issue: 2,
    title: "A New Hiking Era",
    date: "2025-12",
    pages: 96,
    cover: "/navigator/issue-2.webp",
    ...drive({ id: "1TDlQ2PB-vZKL5EWHPxxCX4R7VWszUiJz", bytes: 67_584_909 }),
  },
  {
    // The "Mini Navigator in Winter": "Edition Three: Let It Snow".
    issue: 3,
    title: "Let It Snow",
    date: "2026-02",
    pages: 24,
    cover: "/navigator/issue-3.webp",
    ...drive({ id: "1JMf5OSrkhFvNGTtESUHzZu_XSUfc4yK_", bytes: 50_230_514 }),
  },
  {
    issue: 4,
    title: "Discovering Horizons",
    date: "2026-05",
    pages: 84,
    cover: "/navigator/issue-4.webp",
    // A4 rather than US Letter.
    coverSize: { width: 640, height: 906 },
    // Magazine4_HD_FINAL.pdf, the 431 MB print file. Until its web copy is on
    // Drive the app reads this, and the library warns that it's a big download.
    // Then: drive({ id: "12inNw…", bytes: 430_692_288 }, { id: "<web copy's id>", bytes: <its size> }).
    ...drive({ id: "12inNwa1d5IIovlZHRIVxGS5aSFNR7HwZ", bytes: 430_692_288 }),
  },
];

/** Over this, the library says a download is large and best left for Wi-Fi. */
export const LARGE_DOWNLOAD_BYTES = 150_000_000;

/** "16 MB", "431 MB", "1.2 GB": decimal units, the way Drive and phones count. */
export function formatBytes(bytes: number): string {
  const trim = (n: number) => n.toFixed(1).replace(/\.0$/, "");
  if (bytes >= 1e9) return `${trim(bytes / 1e9)} GB`;
  if (bytes >= 1e7) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e6) return `${trim(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** Newest first: by date, then by issue number for two in the same month. */
export function navigatorIssues(list: readonly NavigatorIssue[] = NAVIGATOR_ISSUES): NavigatorIssue[] {
  return [...list].sort((a, b) => b.date.localeCompare(a.date) || b.issue - a.issue);
}

/** The issue a URL slug names, or null. Only plain issue numbers count. */
export function findNavigatorIssue(slug: string, list: readonly NavigatorIssue[] = NAVIGATOR_ISSUES): NavigatorIssue | null {
  if (!/^[1-9]\d{0,3}$/.test(slug)) return null;
  const n = Number(slug);
  return list.find((issue) => issue.issue === n) ?? null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2025-12" -> "December 2025". */
export function issueDateLabel(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return MONTHS[month - 1] ? `${MONTHS[month - 1]} ${year}` : date;
}

/** "Issue 02" style, as the micro-label on a cover card. */
export function issueLabel(issue: number): string {
  return `Issue ${String(issue).padStart(2, "0")}`;
}

/**
 * How a magazine lays out open on a table: the cover on its own on the right,
 * then facing pairs (2–3, 4–5, …), and an even-numbered last page on its own.
 * Single-page mode is just one page per view.
 */
export function readerViews(pageCount: number, spreads: boolean): number[][] {
  const views: number[][] = [];
  if (pageCount < 1) return views;
  if (!spreads) {
    for (let p = 1; p <= pageCount; p++) views.push([p]);
    return views;
  }
  views.push([1]);
  for (let p = 2; p <= pageCount; p += 2) views.push(p + 1 <= pageCount ? [p, p + 1] : [p]);
  return views;
}

/** Which view shows a given page. */
export function viewIndexOf(views: number[][], page: number): number {
  const i = views.findIndex((view) => view.includes(page));
  return i === -1 ? 0 : i;
}
