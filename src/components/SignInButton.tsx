"use client";

import { useState, type MouseEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { LogIn } from "lucide-react";

export function SignInButton({ compact = false }: { compact?: boolean }) {
  const [opening, setOpening] = useState(false);

  async function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!Capacitor.isNativePlatform()) return;
    event.preventDefault();
    setOpening(true);
    const toolbox = (
      process.env.NEXT_PUBLIC_TOOLBOX_URL || "https://www.adamscampustoolbox.org.uk"
    ).replace(/\/$/, "");
    // Toolbox only needs to allow-list our HTTPS origin. The callback page
    // hands the fragment into the app through its private URL scheme.
    const callback = `${window.location.origin}/auth/callback?native=1`;
    const url = `${toolbox}/api/auth/entra?return_to=${encodeURIComponent(callback)}`;
    try {
      await Browser.open({ url });
    } finally {
      setOpening(false);
    }
  }

  return (
    <a className={compact ? "sign-in compact" : "sign-in"} href="/auth/signin" onClick={handleClick}>
      <LogIn size={16} aria-hidden="true" />
      <span>{opening ? "Opening UCL…" : compact ? "UCL sign in" : "Sign in with UCL"}</span>
    </a>
  );
}
