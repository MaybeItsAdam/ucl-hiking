"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { useRouter } from "next/navigation";

async function exchangeFromUrl(rawUrl: string): Promise<boolean> {
  const url = new URL(rawUrl);
  const isAppCallback =
    (url.protocol === "uclhiking:" && url.hostname === "auth") ||
    url.pathname === "/auth/callback";
  if (!isAppCallback) return false;
  const token = new URLSearchParams(url.hash.slice(1)).get("token");
  if (!token) return false;

  const response = await fetch("/api/auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (response.ok) {
    await Browser.close().catch(() => undefined);
    return true;
  }
  return false;
}

export function NativeAuthBridge() {
  const router = useRouter();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    const listener = App.addListener("appUrlOpen", ({ url }) => {
      if (active) {
        void exchangeFromUrl(url).then((signedIn) => {
          if (signedIn) router.push("/portal");
        });
      }
    });
    return () => {
      active = false;
      void listener.then((handle) => handle.remove());
    };
  }, [router]);
  return null;
}
