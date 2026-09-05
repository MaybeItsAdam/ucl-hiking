"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { LogIn, ShieldCheck, Users, ChevronRight } from "lucide-react";
import { ClubMark } from "@/components/ClubMark";

const societyName = process.env.NEXT_PUBLIC_SOCIETY_NAME || "UCL Hiking Club";

export default function SignInPage() {
  const [opening, setOpening] = useState(false);

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

        <span className="eyebrow">UCL Hiking Club × Adam&apos;s Campus Toolbox</span>
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
        </div>

        <Link className="auth-home" href="/">
          ← Return to {societyName} website
        </Link>
      </section>
    </main>
  );
}
