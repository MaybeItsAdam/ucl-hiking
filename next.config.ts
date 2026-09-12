import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingExcludes: {
    "*": ["cloud-jobs/**"],
  },
};

export default nextConfig;
