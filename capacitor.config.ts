import type { CapacitorConfig } from "@capacitor/cli";

const appUrl = process.env.CAPACITOR_APP_URL || "https://hiking.ucl.example";

const config: CapacitorConfig = {
  appId: "uk.org.ucl.hiking",
  appName: "UCL Hiking Club",
  webDir: "capacitor-dist",
  server: {
    url: appUrl,
    cleartext: appUrl.startsWith("http://"),
  },
  plugins: {
    Browser: { presentationStyle: "popover" },
  },
};

export default config;
