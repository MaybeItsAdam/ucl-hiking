import type { CapacitorConfig } from "@capacitor/cli";

const appUrl = process.env.CAPACITOR_APP_URL || "https://ucl-hiking.vercel.app";

const config: CapacitorConfig = {
  appId: "org.uclhiking.app",
  appName: "UCL Hiking Club",
  webDir: "capacitor-dist",
  // Lets the site tell the app from a phone browser (see src/proxy.ts).
  appendUserAgent: "UCLHikingApp",
  android: {
    adjustMarginsForEdgeToEdge: "auto",
  },
  server: {
    url: appUrl,
    cleartext: appUrl.startsWith("http://"),
  },
  plugins: {
    Browser: { presentationStyle: "popover" },
  },
};

export default config;
