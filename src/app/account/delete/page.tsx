import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClubMark } from "@/components/ClubMark";
import { DeleteAccountForm } from "@/components/DeleteAccountForm";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Delete your account | UCL Hiking Club",
};

export default async function DeleteAccountPage() {
  // The session, not getCurrentMember(): an expired member must still be able to get here.
  const session = await getSession();
  if (!session) redirect("/auth/signin");

  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <Link href="/" className="privacy-brand" aria-label="UCL Hiking Club home">
          <ClubMark size={42} />
          <span>UCL Hiking Club</span>
        </Link>
        <Link href="/portal" className="privacy-back">Back to the portal</Link>
      </header>

      <article className="privacy-content">
        <p className="privacy-eyebrow">Account</p>
        <h1>Delete your account</h1>
        <p className="privacy-date">Signed in as {session.email}</p>

        <p>Deleting your hiking app account removes, straight away:</p>
        <ul>
          <li>your name, email and membership details held by the hiking app</li>
          <li>your equipment requests</li>
          <li>your walk bookings and waitlist places</li>
        </ul>
        <p>
          It does not delete your UCL account, your Adam&apos;s Campus Toolbox sign-in or
          your Students&apos; Union membership. A record that an account was deleted is
          kept, without your name or email. If you are still a club member and sign in
          again, a new, empty account is created.
        </p>
        <p>
          If you have club kit out on loan, return it to the committee before you delete
          your account. See the <Link href="/privacy">privacy policy</Link> for more.
        </p>

        <DeleteAccountForm />
      </article>
    </main>
  );
}
