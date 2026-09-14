"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Mountain } from "lucide-react";

export default function AuthCallback() {
  const [message, setMessage] = useState("Checking your UCL account…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    async function completeSignIn() {
      const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
      history.replaceState(null, "", window.location.pathname);
      if (!token) {
        throw new Error("The sign-in response did not include a token. Please try again.");
      }
      if (new URLSearchParams(window.location.search).get("native") === "1") {
        window.location.replace(`uclhiking://auth/callback#token=${encodeURIComponent(token)}`);
        return;
      }
      const response = await fetch("/api/auth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      // A server crash returns an HTML error page, and parsing that as JSON surfaces
      // as the browser's own cryptic message (Safari: "The string did not match the
      // expected pattern"). Read the body defensively so the user sees something real.
      const body = (await response.json().catch(() => null)) as { error?: string; redirectTo?: string } | null;
      if (!response.ok || !body) {
        throw new Error(
          body?.error ||
            `Sign-in hit a problem on our side (error ${response.status}). Please try again in a few minutes, or tell the committee if it keeps happening.`,
        );
      }
      window.location.replace(body.redirectTo || "/portal");
    }
    void completeSignIn().catch((error: Error) => {
        setMessage(error.message);
        setFailed(true);
      });
  }, []);

  return <main className="auth-page"><section className="auth-card"><span className="auth-mark"><Mountain /></span><h1>{failed ? "Not quite there" : "Nearly on the trail"}</h1><p>{message}</p>{failed ? <Link className="button primary" href="/auth/signin">Try UCL sign in again</Link> : <span className="loading-dots"><i /><i /><i /></span>}<Link className="auth-home" href="/">Back to the homepage</Link></section></main>;
}
