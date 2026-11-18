import type { NextConfig } from "next";
import { legacyRedirects } from "./src/lib/redirects";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Keep a tab the member has just looked at for 30s, so flicking back to it is
    // instant instead of another round trip. Pull-to-refresh still reloads it.
    staleTimes: { dynamic: 30 },
    // A tap on a link with no signal waits and retries when the connection is
    // back, instead of a full reload that fails into the browser's own
    // ERR_INTERNET_DISCONNECTED page. OfflineBanner says why it's waiting.
    useOffline: true,
  },
  async redirects() {
    return legacyRedirects;
  },
  async headers() {
    // Only the canonical host (src/lib/seo.ts) is indexed: previews and the
    // *.vercel.app host the app shell loads say noindex on every response.
    const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    return [
      // The service worker must never come from a cache, or fixes to it stall.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      process.env.VERCEL_ENV === "preview"
        ? { source: "/:path*", headers: noindex }
        : { source: "/:path*", has: [{ type: "host", value: ".*\\.vercel\\.app" }], headers: noindex },
    ];
  },
};

export default nextConfig;
