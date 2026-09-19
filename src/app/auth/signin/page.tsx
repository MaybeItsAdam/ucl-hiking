"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { LogIn, ShieldCheck, Users, ChevronRight, X } from "lucide-react";
import { ClubMark } from "@/components/ClubMark";

const societyName = process.env.NEXT_PUBLIC_SOCIETY_NAME || "UCL Hiking Club";

function toolboxSignInUrl(): string {
  const toolbox = (
    process.env.NEXT_PUBLIC_TOOLBOX_URL || "https://www.adamscampustoolbox.org.uk"
  ).replace(/\/$/, "");
  const callback = `${window.location.origin}/auth/callback?native=1`;
  return `${toolbox}/api/auth/entra?return_to=${encodeURIComponent(callback)}`;
}

function SignIn() {
  // "opening": leaving for UCL sign-in. "waiting": the app's system browser is
  // open, and NativeAuthBridge takes over when it hands back.
  const [stage, setStage] = useState<"idle" | "opening" | "waiting">("idle");
  // A failed in-app sign-in comes back here as ?error=, set by NativeAuthBridge.
  const returnedError = useSearchParams().get("error");
  const [dismissedError, setDismissedError] = useState(false);
  const signInError = dismissedError ? null : returnedError;

  // Store reviewers have no UCL account. Seven taps on the eyebrow line reveal
  // an email/password form for the Toolbox reviewer accounts — the same
  // seven-tap gesture Toolbox uses, so one set of review notes covers both.
  const taps = useRef(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    // Back from UCL sign-in via the browser's back button restores this page
    // from the back/forward cache, still saying "Opening…".
    const reset = (event: PageTransitionEvent) => event.persisted && setStage("idle");
    window.addEventListener("pageshow", reset);
    if (!Capacitor.isNativePlatform()) return () => window.removeEventListener("pageshow", reset);
    // Closing the browser without finishing drops back to the button.
    const listener = Browser.addListener("browserFinished", () => setStage("idle"));
    return () => {
      window.removeEventListener("pageshow", reset);
      void listener.then((handle) => handle.remove());
    };
  }, []);

  function handleEyebrowTap() {
    taps.current += 1;
    if (taps.current >= 7) setReviewOpen(true);
  }

  async function handleReviewSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setReviewBusy(true);
    setReviewError(null);
    try {
      const response = await fetch("/api/auth/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string; redirectTo?: string } | null;
      if (!response.ok || !body) throw new Error(body?.error || `Sign-in failed (error ${response.status}).`);
      window.location.replace(body.redirectTo || "/portal");
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "Sign-in failed.");
      setReviewBusy(false);
    }
  }

  async function handleStartSignIn(event: MouseEvent<HTMLAnchorElement>) {
    setDismissedError(true);
    setStage("opening");
    if (!Capacitor.isNativePlatform()) return;
    event.preventDefault();
    try {
      await Browser.open({ url: toolboxSignInUrl() });
      setStage("waiting");
    } catch {
      setStage("idle");
    }
  }

  return (
    <main className="auth-page signin-page">
      <section className="auth-card authenticator-card">
        <div className="signin-intro">
          <div className="auth-header-brand">
            <ClubMark size={52} />
            <X size={16} strokeWidth={3} className="auth-brand-cross" aria-hidden="true" />
            <Image
              src="/brand/toolbox-logo.png"
              width={52}
              height={52}
              alt="Adam's Campus Toolbox"
              className="rounded-xl shadow-sm"
              priority
            />
          </div>

          <span className="eyebrow" onClick={handleEyebrowTap}>UCL Hiking Club × Adam&apos;s Campus Toolbox</span>
          <h1>Sign in to {societyName}</h1>
          <p>Use your UCL account to borrow club kit and reach the member portal.</p>

          <div className="authenticator-info-box">
            <div className="info-row">
              <ShieldCheck size={18} className="info-icon" aria-hidden="true" />
              <div>
                <strong>UCL single sign-on</strong>
                <small>Your usual UCL login, through Adam&apos;s Campus Toolbox. The club never sees your password.</small>
              </div>
            </div>
            <div className="info-row">
              <Users size={18} className="info-icon" aria-hidden="true" />
              <div>
                <strong>Club membership</strong>
                <small>We match you to the club&apos;s Students&apos; Union member list to set up your access.</small>
              </div>
            </div>
          </div>
        </div>

        <div className="auth-actions">
          {signInError && (
            <p className="signin-error" role="alert">{signInError}</p>
          )}

          {stage === "waiting" ? (
            <div className="signin-waiting" role="status">
              <span className="loading-dots"><i /><i /><i /></span>
              <p>Finish signing in in the browser window. It brings you straight back here.</p>
              <a className="button full-width" href="/api/auth/start" onClick={handleStartSignIn}>
                Open UCL sign-in again
              </a>
            </div>
          ) : (
            <a
              className="button primary full-width authenticator-btn"
              href="/api/auth/start"
              onClick={handleStartSignIn}
              aria-busy={stage === "opening"}
            >
              <LogIn size={18} aria-hidden="true" />
              <span>{stage === "opening" ? "Opening UCL sign-in…" : "Continue with UCL sign-in"}</span>
              <ChevronRight size={18} aria-hidden="true" />
            </a>
          )}

          {reviewOpen && (
            <form className="su-session-form review-signin" onSubmit={handleReviewSignIn}>
              <div className="form-group">
                <label htmlFor="review-email">Reviewer email</label>
                <input id="review-email" name="email" type="email" autoComplete="username" autoCapitalize="none" required />
              </div>
              <div className="form-group">
                <label htmlFor="review-password">Password</label>
                <input id="review-password" name="password" type="password" autoComplete="current-password" required />
              </div>
              {reviewError && <p className="review-signin-error" role="alert">{reviewError}</p>}
              <button className="button full-width" type="submit" disabled={reviewBusy}>
                {reviewBusy ? "Signing in..." : "Reviewer sign-in"}
              </button>
            </form>
          )}

          {process.env.NODE_ENV === "development" && (
            <a
              className="button full-width"
              style={{ marginTop: 12, background: "var(--surface-2)", borderColor: "var(--line-strong)", color: "var(--ink)", fontSize: 13 }}
              href="/api/auth/dev-login"
            >
              <span>⚡ Quick Dev Sign-In (Local Admin)</span>
            </a>
          )}

          <nav className="signin-links" aria-label="More">
            <Link href="/#join">Not a member yet?</Link>
            <Link href="/privacy">Privacy policy</Link>
          </nav>
        </div>
      </section>
    </main>
  );
}

// useSearchParams needs a Suspense boundary to keep the page prerenderable.
export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
