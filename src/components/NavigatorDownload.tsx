"use client";

import type { ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { LARGE_DOWNLOAD_BYTES } from "@/lib/navigator";

/**
 * Saves an issue's PDF, in one tap.
 *
 * On the web it is a plain download link: through the members-only proxy, which
 * names the file properly, or straight from Drive for a print file too big to
 * relay inside a function's time limit. Drive sends it as an attachment either way.
 *
 * In the phone app a link like that goes nowhere: neither WebView does anything
 * with a download. So the app opens the Drive download in the system browser
 * sheet instead (it has no session, but the file is shared publicly), which
 * hands it to the phone: Android's Chrome saves it to Downloads, and on iOS
 * Safari offers it to the Files app, or shows it with a share button to save it.
 */
export function NavigatorDownload({
  issue,
  directUrl,
  bytes,
  className,
  title,
  children,
}: {
  issue: number;
  directUrl: string;
  bytes: number | null;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const href = bytes && bytes > LARGE_DOWNLOAD_BYTES ? directUrl : `/api/navigator/${issue}?download`;
  return (
    <a
      className={className}
      href={href}
      download
      title={title}
      onClick={(event) => {
        if (!Capacitor.isNativePlatform()) return;
        event.preventDefault();
        void Browser.open({ url: directUrl });
      }}
    >
      {children}
    </a>
  );
}
