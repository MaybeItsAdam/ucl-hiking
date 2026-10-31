import { describe, expect, it } from "vitest";
import {
  NAVIGATOR_ISSUES,
  NAVIGATOR_PDF_HOSTS,
  findNavigatorIssue,
  issueDateLabel,
  issueLabel,
  navigatorIssues,
  readerViews,
  viewIndexOf,
  type NavigatorIssue,
} from "./navigator";

const issue = (n: number, date: string): NavigatorIssue => ({ issue: n, title: `T${n}`, date, pdfUrl: "x", sourceUrl: "y" });

describe("navigatorIssues", () => {
  it("puts the newest first", () => {
    const sorted = navigatorIssues([issue(1, "2025-02"), issue(3, "2026-03"), issue(2, "2025-12")]);
    expect(sorted.map((i) => i.issue)).toEqual([3, 2, 1]);
  });
  it("breaks a same-month tie by issue number", () => {
    expect(navigatorIssues([issue(4, "2026-01"), issue(5, "2026-01")]).map((i) => i.issue)).toEqual([5, 4]);
  });
});

describe("the issue list", () => {
  it("only points the proxy at allowlisted hosts", () => {
    for (const entry of NAVIGATOR_ISSUES) expect(NAVIGATOR_PDF_HOSTS.has(new URL(entry.pdfUrl).hostname)).toBe(true);
  });
  it("has unique issue numbers", () => {
    expect(new Set(NAVIGATOR_ISSUES.map((i) => i.issue)).size).toBe(NAVIGATOR_ISSUES.length);
  });
});

describe("findNavigatorIssue", () => {
  const list = [issue(1, "2025-02"), issue(2, "2025-12")];
  it("finds by number", () => expect(findNavigatorIssue("2", list)?.title).toBe("T2"));
  it("rejects anything that isn't a plain number", () => {
    for (const slug of ["02", "2.0", "-1", "", "2abc", "https://evil"]) expect(findNavigatorIssue(slug, list)).toBeNull();
  });
  it("returns null for an issue that doesn't exist", () => expect(findNavigatorIssue("9", list)).toBeNull());
});

describe("labels", () => {
  it("names the month", () => expect(issueDateLabel("2025-12")).toBe("December 2025"));
  it("leaves a bad date alone", () => expect(issueDateLabel("soon")).toBe("soon"));
  it("pads the issue number", () => expect(issueLabel(2)).toBe("Issue 02"));
});

describe("readerViews", () => {
  it("is one page per view on a phone", () => {
    expect(readerViews(3, false)).toEqual([[1], [2], [3]]);
  });
  it("opens like a magazine: cover alone, then facing pages", () => {
    expect(readerViews(5, true)).toEqual([[1], [2, 3], [4, 5]]);
  });
  it("leaves an even last page on its own", () => {
    expect(readerViews(6, true)).toEqual([[1], [2, 3], [4, 5], [6]]);
  });
  it("copes with nothing", () => expect(readerViews(0, true)).toEqual([]));
  it("finds the view a page is in", () => {
    const views = readerViews(6, true);
    expect(viewIndexOf(views, 1)).toBe(0);
    expect(viewIndexOf(views, 5)).toBe(2);
    expect(viewIndexOf(views, 99)).toBe(0);
  });
});
