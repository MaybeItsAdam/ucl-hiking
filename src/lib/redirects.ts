import type { NextConfig } from "next";

type RedirectItem = Awaited<ReturnType<NonNullable<NextConfig["redirects"]>>>[number];

/**
 * Legacy URL redirects imported from Wix URL Redirects export: the ones outside
 * /e/ and /media/, and the wildcards for the old blog. Short links under /e/
 * and /media/ are the committee's, in the `club_links` table (see clubLinks.ts);
 * these run first, so don't add a source under those prefixes here.
 */
export const legacyRedirects: RedirectItem[] = [
  {
    source: "/merch",
    destination: "https://studentsunionucl.org/clubs-societies/hiking-club/products",
    permanent: true,
  },
  {
    source: "/events",
    destination: "/e/events",
    permanent: true,
  },
  {
    source: "/hike",
    destination: "/h",
    permanent: true,
  },
  {
    source: "/single-post/2018/01/31/We-need-to-talk-about-boots\u2026",
    destination: "/post/2018/01/31/we-need-to-talk-about-boots-e2-80-a6",
    permanent: true,
  },
  {
    source: "/single-post/2018/01/31/We-need-to-talk-about-boots%E2%80%A6",
    destination: "/post/2018/01/31/we-need-to-talk-about-boots-e2-80-a6",
    permanent: true,
  },
  {
    source: "/single-post/2018/01/31/We-need-to-talk-about-boots%e2%80%a6",
    destination: "/post/2018/01/31/we-need-to-talk-about-boots-e2-80-a6",
    permanent: true,
  },
  {
    source: "/feedback",
    destination: "/e/feedback",
    permanent: true,
  },
  {
    source: "/r/logo",
    destination: "https://static.wixstatic.com/media/29bf68_d35a95bd306f4fd3be0f62c75d569c4e~mv2.png",
    permanent: true,
  },
  {
    source: "/wl",
    destination: "https://linktr.ee/ucl_walk_leaders",
    permanent: true,
  },
  {
    source: "/single-post/:path*",
    destination: "/post/:path*",
    permanent: true,
  },
  {
    source: "/category/:path*",
    destination: "/blog-1/categories/:path*",
    permanent: true,
  },
];
