import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Inbox } from "@/components/Inbox";
import { getRealMember } from "@/lib/session";

export const metadata: Metadata = { title: "Inbox | UCL Hiking Club" };

export default async function InboxPage() {
  if (!(await getRealMember())) redirect("/auth/signin");
  return (
    <article className="events-page">
      <Inbox />
    </article>
  );
}
