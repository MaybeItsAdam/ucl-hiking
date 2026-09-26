"use client";

import type { ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

/**
 * A link out of the app. On the phone app it opens in the in-app browser
 * sheet, so the member comes straight back; on the web it is a new tab.
 */
export function OpenExternal({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (!Capacitor.isNativePlatform()) return;
        e.preventDefault();
        void Browser.open({ url: href });
      }}
    >
      {children}
    </a>
  );
}
