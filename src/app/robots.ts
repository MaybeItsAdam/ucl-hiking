import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { IS_PREVIEW, SITE_HOST, SITE_URL } from "@/lib/seo";

// Search and AI crawlers, named so the intent is plain: all of them are welcome.
const CRAWLERS = [
  "Googlebot",
  "Bingbot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "PerplexityBot",
  "Perplexity-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "Google-Extended",
  "Applebot",
  "Applebot-Extended",
  "DuckAssistBot",
];

// Behind UCL sign-in, or no use to a searcher.
const PRIVATE = ["/api/", "/auth/", "/portal", "/account", "/calendar"];

/**
 * One robots.txt per host. The same production deployment also answers on
 * ucl-hiking.vercel.app (the app shell loads it), which must stay out of the
 * index, as must every preview.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host") ?? "";
  if (IS_PREVIEW || host !== SITE_HOST) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: [
      { userAgent: CRAWLERS, allow: "/", disallow: PRIVATE },
      { userAgent: "*", allow: "/", disallow: PRIVATE },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
