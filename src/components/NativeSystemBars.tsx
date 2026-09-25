"use client";

import { useEffect } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";

// The Android app's own plugin (android/.../SystemBarsPlugin.java).
const HikingSystemBars = registerPlugin<{ setStyle(options: { dark: boolean }): Promise<void> }>("HikingSystemBars");

/**
 * The Android app draws the page behind the status and navigation bars, so
 * their icons have to follow the page's theme — which can differ from the
 * phone's when a theme is chosen in Settings — or they vanish into it.
 */
export function NativeSystemBars() {
  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let last: boolean | null = null;

    function sync() {
      const choice = root.getAttribute("data-theme");
      const dark = choice === "dark" || (choice !== "light" && media.matches);
      if (dark === last) return;
      last = dark;
      HikingSystemBars.setStyle({ dark }).catch(() => {
        // An app build from before the plugin: its bars just keep the phone's style.
      });
    }

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    media.addEventListener("change", sync);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", sync);
    };
  }, []);

  return null;
}
