/**
 * The Navigator, the club magazine ("A Magazine By the Club, For the Club").
 *
 * Every issue the app knows about lives here and nowhere else. The PDFs sit on
 * the club's Google Drive, which won't let a browser fetch them cross-origin, so
 * the reader loads them through /api/navigator/[issue] — and that route only ever
 * fetches a `pdfUrl` from this list, never a URL it was handed.
 *
 * Adding an issue: share the PDF on Drive as "anyone with the link", put its file
 * id into the two URLs below, render page 1 to public/navigator/issue-N.webp
 * (about 640px wide) and add an entry. Order doesn't matter; the library sorts.
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
  /** A direct download of the PDF. Fetched server-side only, by the proxy route. */
  pdfUrl: string;
  /** Where the original lives, for "open original". */
  sourceUrl: string;
  /** Page 1, rendered, under public/. */
  cover?: string;
};

/** Hosts the proxy may fetch from. A belt to go with the braces of a fixed list. */
export const NAVIGATOR_PDF_HOSTS: ReadonlySet<string> = new Set(["drive.usercontent.google.com"]);

const drive = (id: string) => ({
  pdfUrl: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
  sourceUrl: `https://drive.google.com/file/d/${id}/view`,
});

// The two issues the old site linked to as /e/navigator/1 and /e/navigator/2
// (see src/lib/redirects.ts). Titles and dates are from the covers.
export const NAVIGATOR_ISSUES: readonly NavigatorIssue[] = [
  {
    issue: 1,
    title: "Trail Mix",
    date: "2025-02",
    pages: 72,
    cover: "/navigator/issue-1.webp",
    ...drive("1uW8CImkdw_h0-RW_aUxKeByXKPQu1X02"),
  },
  {
    issue: 2,
    title: "A New Hiking Era",
    date: "2025-12",
    pages: 96,
    cover: "/navigator/issue-2.webp",
    ...drive("1TDlQ2PB-vZKL5EWHPxxCX4R7VWszUiJz"),
  },
];

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
