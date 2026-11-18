import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * The public pages only. Walks have no public page of their own (they are
 * listed on /walks); the portal, sign-in and the /e/ and /media/ short links
 * are left out. lastModified only where the page states a real date.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/walks`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/support`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${SITE_URL}/privacy`, lastModified: "2026-09-26", changeFrequency: "yearly", priority: 0.3 },
  ];
}
