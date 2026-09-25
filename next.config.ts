import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Keep a tab the member has just looked at for 30s, so flicking back to it is
    // instant instead of another round trip. Pull-to-refresh still reloads it.
    staleTimes: { dynamic: 30 },
  },
  outputFileTracingExcludes: {
    "*": ["cloud-jobs/**"],
  },
};

export default nextConfig;
