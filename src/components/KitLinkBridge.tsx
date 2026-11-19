"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { KIT_LINK_PATH, parseKitLink } from "@/lib/kitTag";
import { msSinceInAppTag } from "@/lib/nfc";

// App.getLaunchUrl() keeps answering with the link that cold-started the app
// for as long as the process lives; this remembers it was already followed.
const FOLLOWED_KEY = "hiking:followed-launch-url";

/**
 * A kit tag's link, https://www.uclhiking.org/kit/<id> (or uclhiking://kit/<id>
 * from the "Open in the app" button), opened the app: show that item. The app
 * shell loads its own host, so the link is followed as a path on it; the
 * /kit/<id> page sends a member who handles kit on to the item in the
 * equipment portal, and shows anyone else the public page.
 *
 * Android hands a tag still against the phone back to the system once the
 * app's own reader lets go of it, which would fire its link here right after
 * an in-app scan of the same tag; links that soon after an in-app read are
 * ignored, since the scanner has already shown the item.
 */
export function KitLinkBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;

    function follow(rawUrl: string | undefined) {
      const id = rawUrl ? parseKitLink(rawUrl, [window.location.host]) : null;
      if (!active || !id) return;
      if (msSinceInAppTag() < IN_APP_ECHO_MS) return;
      router.push(`${KIT_LINK_PATH}/${id}`);
    }

    const listener = App.addListener("appUrlOpen", ({ url }) => follow(url));
    void App.getLaunchUrl().then((launch) => {
      const url = launch?.url;
      if (!url) return;
      try {
        if (sessionStorage.getItem(FOLLOWED_KEY) === url) return;
        sessionStorage.setItem(FOLLOWED_KEY, url);
      } catch {
        // Without storage a reload may follow the launch link again; harmless.
      }
      follow(url);
    });

    return () => {
      active = false;
      void listener.then((handle) => handle.remove());
    };
  }, [router]);

  return null;
}

/** How long after an in-app tag read a kit link is taken to be that same tag. */
const IN_APP_ECHO_MS = 10_000;
