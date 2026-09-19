"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";

// A token is single-use, and App.getLaunchUrl() keeps returning the URL that
// cold-started the app for as long as the process lives, so remember which
// handoffs this app session has already spent.
const SPENT_KEY = "hiking:spent-auth-tokens";

function appCallbackToken(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const isAppCallback =
    (url.protocol === "uclhiking:" && url.hostname === "auth") ||
    url.pathname === "/auth/callback";
  if (!isAppCallback) return null;
  return new URLSearchParams(url.hash.slice(1)).get("token");
}

function claimToken(token: string): boolean {
  try {
    const spent: string[] = JSON.parse(sessionStorage.getItem(SPENT_KEY) || "[]");
    if (spent.includes(token)) return false;
    sessionStorage.setItem(SPENT_KEY, JSON.stringify([...spent.slice(-4), token]));
  } catch {
    // Without storage the worst case is a repeat exchange that fails harmlessly.
  }
  return true;
}

async function exchange(token: string): Promise<string | null> {
  try {
    const response = await fetch("/api/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (response.ok) return null;
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return body?.error || `Sign-in hit a problem on our side (error ${response.status}). Please try again.`;
  } catch {
    return "Couldn't reach the club's server. Check your connection and try again.";
  }
}

/**
 * Finishes a native sign-in: the system browser hands the Toolbox token back
 * through uclhiking://auth/callback, and this swaps it for the session cookie.
 * Success replaces the page with the portal, so Android's back button doesn't
 * return to the sign-in screen; failure lands back on it with the reason.
 */
export function NativeAuthBridge() {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;

    async function handle(rawUrl: string | undefined) {
      const token = rawUrl ? appCallbackToken(rawUrl) : null;
      if (!active || !token || !claimToken(token)) return;
      setBusy(true);
      await Browser.close().catch(() => undefined);
      const error = await exchange(token);
      window.location.replace(error ? `/auth/signin?error=${encodeURIComponent(error)}` : "/portal");
    }

    const listener = App.addListener("appUrlOpen", ({ url }) => void handle(url));
    // If the phone reclaimed the app while the browser was open, the callback
    // cold-starts it instead of firing appUrlOpen on a live page.
    void App.getLaunchUrl().then((launch) => handle(launch?.url));

    return () => {
      active = false;
      void listener.then((handle) => handle.remove());
    };
  }, []);

  if (!busy) return null;
  return (
    <div className="native-auth-overlay" role="status" aria-live="polite">
      <span className="loading-dots"><i /><i /><i /></span>
      <p>Signing you in…</p>
    </div>
  );
}
