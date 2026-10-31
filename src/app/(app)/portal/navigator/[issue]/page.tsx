import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { NavigatorReader } from "@/components/NavigatorReader";
import { findNavigatorIssue, issueLabel } from "@/lib/navigator";
import { getCurrentMember } from "@/lib/session";

type Params = { params: Promise<{ issue: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const issue = findNavigatorIssue((await params).issue);
  return { title: issue ? `${issue.title} · The Navigator | UCL Hiking Club` : "The Navigator | UCL Hiking Club" };
}

/** One issue, open in the reader. */
export default async function NavigatorIssuePage({ params }: Params) {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const issue = findNavigatorIssue((await params).issue);
  if (!issue) notFound();

  return (
    <NavigatorReader
      issue={issue.issue}
      src={`/api/navigator/${issue.issue}`}
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
