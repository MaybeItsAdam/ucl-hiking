import type { Metadata } from "next";
import Link from "next/link";
import { ClubMark } from "@/components/ClubMark";

export const metadata: Metadata = {
  title: "App support | UCL Hiking Club",
  description: "Help with UCL Hiking Club sign-in, equipment requests and the mobile app.",
};

export default function SupportPage() {
  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <Link href="/" className="privacy-brand" aria-label="UCL Hiking Club home">
          <ClubMark size={42} />
          <span>UCL Hiking Club</span>
        </Link>
        <Link href="/" className="privacy-back">Back to the hiking website</Link>
      </header>
      <article className="privacy-content">
        <p className="privacy-eyebrow">UCL Hiking Club website and mobile app</p>
        <h1>App support</h1>
        <p>
          Need help with UCL Hiking Club? Contact MaybeItsSoftware, the app owner,
          at <a href="mailto:support@uclhiking.org">support@uclhiking.org</a>.
        </p>
        <h2>Sign-in and membership</h2>
        <p>
          Sign in with your UCL account through Adam&apos;s Campus Toolbox.
          Equipment requests are available to Explorer members and the
          committee. If your membership is missing or you cannot sign in, tell us
          what happened and include any error message you saw.
        </p>
        <h2>Equipment requests</h2>
        <p>
          Check your requests in the member portal for their current status.
          Include the equipment name and requested dates when contacting us
          about a loan.
        </p>
        <h2>Report an app problem</h2>
        <p>
          Include your phone model, iOS or Android version, and the steps that
          led to the problem. Never send your password or a sign-in code.
        </p>
        <h2>Privacy and account deletion</h2>
        <p>
          Contact <a href="mailto:privacy@uclhiking.org">privacy@uclhiking.org</a>
          {" "}for privacy requests, or read our{" "}
          <Link href="/privacy">privacy policy</Link> and{" "}
          <Link href="/privacy#request-deletion">account deletion information</Link>.
        </p>
      </article>
    </main>
  );
}
