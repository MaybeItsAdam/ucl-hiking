import type { NextConfig } from "next";
import { legacyRedirects } from "./src/lib/redirects";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Keep a tab the member has just looked at for 30s, so flicking back to it is
    // instant instead of another round trip. Pull-to-refresh still reloads it.
    staleTimes: { dynamic: 30 },
  },
  async redirects() {
    return legacyRedirects;
  },
};

export default nextConfig;
