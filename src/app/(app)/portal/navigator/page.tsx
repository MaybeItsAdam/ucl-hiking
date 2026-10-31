import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, Download } from "lucide-react";
import { NavigatorDownload } from "@/components/NavigatorDownload";
import { NavigatorSave } from "@/components/NavigatorSave";
import { formatBytes, issueDateLabel, issueLabel, LARGE_DOWNLOAD_BYTES, navigatorIssues, navigatorVersion } from "@/lib/navigator";
import { getCurrentMember } from "@/lib/session";

export const metadata: Metadata = { title: "The Navigator | UCL Hiking Club" };

/** Every issue of the club magazine, newest first, as a shelf of covers. */
export default async function NavigatorLibraryPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const issues = navigatorIssues();

  return (
    <article className="navigator-library">
      <header className="navigator-intro">
        <p className="event-eyebrow">The club magazine</p>
        <p>A magazine by the club, for the club: walks, residentials, photography, art and the people behind it all.</p>
      </header>

      {issues.length ? (
        <ul className="navigator-shelf">
          {issues.map((issue, i) => (
            <li key={issue.issue}>
              <Link href={`/portal/navigator/${issue.issue}`} className="navigator-card">
                {/* Each cover keeps its own shape: US Letter and A4 issues sit side by side. */}
                <span
                  className="navigator-cover"
                  style={issue.coverSize ? { aspectRatio: `${issue.coverSize.width} / ${issue.coverSize.height}` } : undefined}
                >
                  {issue.cover ? (
                    <Image
                      src={issue.cover}
                      alt={`Cover of The Navigator, ${issueLabel(issue.issue).toLowerCase()}: ${issue.title}`}
                      width={issue.coverSize?.width ?? 640}
                      height={issue.coverSize?.height ?? 828}
                      sizes="(max-width: 520px) 50vw, 240px"
                      priority={i < 2}
                    />
                  ) : (
                    <span className="navigator-cover-blank" aria-hidden="true">
                      <BookOpen size={28} />
                    </span>
                  )}
                </span>
                <span className="navigator-card-text">
                  <span className="navigator-card-label">
                    {issueLabel(issue.issue)}
                    {i === 0 ? <span className="navigator-latest">Latest</span> : null}
                  </span>
                  <strong>{issue.title}</strong>
                  <span className="navigator-card-meta">
                    {issueDateLabel(issue.date)}
                    {issue.pages ? ` · ${issue.pages} pages` : ""}
                  </span>
                </span>
              </Link>
              {issue.bytes ? (
                <div className="navigator-card-download">
                  <NavigatorDownload
                    issue={issue.issue}
                    directUrl={issue.pdfUrl}
                    bytes={issue.bytes}
                    className="navigator-download-btn"
                  >
                    <Download size={16} aria-hidden="true" />
                    <span>
                      Download <span className="navigator-download-size">· {formatBytes(issue.bytes)}</span>
                    </span>
                    <span className="sr-only">
                      {`, ${issueLabel(issue.issue)}, ${issue.title}, PDF`}
                    </span>
                  </NavigatorDownload>
                  {issue.bytes > LARGE_DOWNLOAD_BYTES ? (
                    <span className="navigator-download-note">Print quality. Best on Wi-Fi.</span>
                  ) : (
                    <NavigatorSave issue={issue.issue} version={navigatorVersion(issue)} bytes={issue.bytes} />
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="navigator-empty">
          <BookOpen size={28} aria-hidden="true" />
          <p>No issues yet. The next one will turn up here.</p>
        </div>
      )}
    </article>
  );
}
