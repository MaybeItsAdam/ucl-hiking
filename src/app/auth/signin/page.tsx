"use client";

import { useRef, useState, type FormEvent, type MouseEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { LogIn, ShieldCheck, Users, ChevronRight } from "lucide-react";
import { ClubMark } from "@/components/ClubMark";

const societyName = process.env.NEXT_PUBLIC_SOCIETY_NAME || "UCL Hiking Club";

export default function SignInPage() {
  const [opening, setOpening] = useState(false);
  // Store reviewers have no UCL account. Seven taps on the eyebrow line reveal
  // an email/password form for the Toolbox reviewer accounts — the same
  // seven-tap gesture Toolbox uses, so one set of review notes covers both.
  const taps = useRef(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

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
    if (!Capacitor.isNativePlatform()) return;
    event.preventDefault();
    setOpening(true);
    const toolbox = (
      process.env.NEXT_PUBLIC_TOOLBOX_URL || "https://www.adamscampustoolbox.org.uk"
    ).replace(/\/$/, "");
    const callback = `${window.location.origin}/auth/callback?native=1`;
    const url = `${toolbox}/api/auth/entra?return_to=${encodeURIComponent(callback)}`;
    try {
      await Browser.open({ url });
    } finally {
      setOpening(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card authenticator-card">
        <div className="auth-header-brand">
          <ClubMark size={52} />
          <span className="auth-brand-cross">✕</span>
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
        <p>
          Authenticate using your official UCL Single Sign-On account to access member features, event bookings, and society portals.
        </p>

        <div className="authenticator-info-box">
          <div className="info-row">
            <ShieldCheck size={18} className="info-icon" />
            <div>
              <strong>UCL Single Sign-On</strong>
              <small>Delegated via Adam&apos;s Campus Toolbox to authenticate your UCL student or staff tenant identity.</small>
            </div>
          </div>
          <div className="info-row">
            <Users size={18} className="info-icon" />
            <div>
              <strong>Official Society Roster</strong>
              <small>Cross-checks your email against the Students&apos; Union roster to assign member roles automatically.</small>
            </div>
          </div>
        </div>

        <div className="auth-actions">
          <a
            className="button primary full-width authenticator-btn"
            href="/api/auth/start"
            onClick={handleStartSignIn}
          >
            <LogIn size={18} />
            <span>{opening ? "Opening UCL Sign-In..." : "Continue with UCL Sign-In"}</span>
            <ChevronRight size={18} />
          </a>

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
              style={{ marginTop: 12, background: "#f1f5f9", borderColor: "#94a3b8", color: "#1e293b", fontSize: 13 }}
              href="/api/auth/dev-login"
            >
              <span>⚡ Quick Dev Sign-In (Local Admin)</span>
            </a>
          )}
        </div>

        <Link className="auth-home" href="/">
          ← Return to {societyName} website
        </Link>
        <Link className="auth-privacy-link" href="/privacy">Privacy policy</Link>
      </section>
    </main>
  );
}
