import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { NavigatorReader } from "@/components/NavigatorReader";
import { findNavigatorIssue, issueLabel, navigatorVersion } from "@/lib/navigator";
import { getArchiveViewer } from "@/lib/archiveViewer";

type Params = { params: Promise<{ issue: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const issue = findNavigatorIssue((await params).issue);
  return { title: issue ? `${issue.title} · The Navigator | UCL Hiking Club` : "The Navigator | UCL Hiking Club" };
}

/** One issue, open in the reader. */
export default async function NavigatorIssuePage({ params }: Params) {
  // Alumni too (lib/alumni).
  const viewer = await getArchiveViewer();
  if (!viewer) redirect("/auth/signin");
  const issue = findNavigatorIssue((await params).issue);
  if (!issue) notFound();

  return (
    <NavigatorReader
      issue={issue.issue}
      src={`/api/navigator/${issue.issue}`}
      version={navigatorVersion(issue)}
      directUrl={issue.pdfUrl}
      bytes={issue.bytes ?? null}
      sourceUrl={issue.sourceUrl}
      label={issueLabel(issue.issue)}
      title={issue.title}
      cover={issue.cover ?? null}
      knownPages={issue.pages ?? null}
    />
  );
}
