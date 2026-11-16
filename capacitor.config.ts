import type { CapacitorConfig } from "@capacitor/cli";

const appUrl = process.env.CAPACITOR_APP_URL || "https://ucl-hiking.vercel.app";

const config: CapacitorConfig = {
  appId: "org.uclhiking.app",
  appName: "UCL Hiking Club",
  webDir: "capacitor-dist",
  // Lets the site tell the app from a phone browser (see src/proxy.ts).
  appendUserAgent: "UCLHikingApp",
  ios: {
    // WKWebView only runs service workers (public/sw.js: walk-day registers and
    // the kit scanner opening with no signal) for app-bound domains, listed
    // under WKAppBoundDomains in ios/App/App/Info.plist. Any CAPACITOR_APP_URL
    // host must be on that list too, or the app won't load it. Links to other
    // sites already leave the app (Capacitor opens them in Safari).
    limitsNavigationsToAppBoundDomains: true,
  },
  android: {
    // Draw behind the status and navigation bars. MainActivity passes the bars'
    // sizes to the page as --android-inset-* so it can pad around them itself.
    adjustMarginsForEdgeToEdge: "disable",
  },
  server: {
    url: appUrl,
    cleartext: appUrl.startsWith("http://"),
    // Shown from the app bundle (capacitor-dist) whenever a whole page fails to
    // load (no signal, the site down; on Android any HTTP error too), instead of
    // the WebView's own ERR_INTERNET_DISCONNECTED screen. Retries by itself once
    // back online.
    errorPath: "index.html",
  },
  plugins: {
    Browser: { presentationStyle: "popover" },
  },
};

export default config;
