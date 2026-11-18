import type { Metadata } from "next";
import { SU_MEMBERSHIP_URL } from "@/lib/toolbox";

/**
 * Search and AI-citation plumbing: the one canonical origin, per-page metadata
 * and the JSON-LD graph. Every indexable page points its canonical here, and
 * robots.ts tells crawlers on any other host (ucl-hiking.vercel.app, previews)
 * to stay out.
 *
 * www.uclhiking.org is the origin that answers 200; the bare uclhiking.org
 * 308s to it. NEXT_PUBLIC_APP_URL is not reused because the app shell and the
 * calendar feeds point that at ucl-hiking.vercel.app.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.uclhiking.org").replace(/\/+$/, "");
export const SITE_HOST = new URL(SITE_URL).host;
export const SITE_NAME = "UCL Hiking Club";

/** Vercel preview builds are never indexed. Production serves several hosts; robots.ts sorts those out. */
export const IS_PREVIEW = process.env.VERCEL_ENV === "preview";

export const SITE_DESCRIPTION =
  "UCL Hiking Club is the hiking society for UCL students: weekend walks out of London, mountain weekends and good company. Open to every UCL student.";

// The share card from app/opengraph-image.tsx. A page that sets its own
// openGraph replaces the inherited one, so each names the card again.
const shareImage = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "UCL Hiking Club: weekend walks, mountain weekends and good company",
};

/** Title, description, canonical, Open Graph and Twitter card for one indexable page. */
export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path, siteName: SITE_NAME, locale: "en_GB", type: "website", images: [shareImage] },
    twitter: { card: "summary_large_image", title, description, images: [shareImage] },
  };
}

/** Kept out of search: sign-in, the member portal and anything else behind UCL login. */
export const noIndex: Metadata = { robots: { index: false, follow: false } };

export const ids = {
  website: `${SITE_URL}/#website`,
  club: `${SITE_URL}/#club`,
  webApp: `${SITE_URL}/#webapp`,
  mobileApp: `${SITE_URL}/#app`,
  adam: "https://maybeitssoftware.co.uk/#adam",
  maybeItsSoftware: "https://maybeitssoftware.co.uk/#org",
};

const adam = {
  "@type": "Person",
  "@id": ids.adam,
  name: "Adam Cleary",
  sameAs: ["https://github.com/MaybeItsAdam"],
};

const maybeItsSoftware = {
  "@type": "Organization",
  "@id": ids.maybeItsSoftware,
  name: "MaybeItsSoftware",
  url: "https://maybeitssoftware.co.uk",
  sameAs: ["https://github.com/MaybeItsSoftware"],
};

/** The front page's graph: the site, the club, and the website/app members use. */
export function homeGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": ids.website,
        url: `${SITE_URL}/`,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        inLanguage: "en-GB",
        publisher: { "@id": ids.club },
      },
      {
        "@type": "SportsOrganization",
        "@id": ids.club,
        name: SITE_NAME,
        alternateName: "UCL Hiking",
        url: `${SITE_URL}/`,
        logo: `${SITE_URL}/icon-512.png`,
        description: SITE_DESCRIPTION,
        sport: "Hiking",
        areaServed: "London",
        parentOrganization: { "@type": "Organization", name: "Students' Union UCL", url: "https://studentsunionucl.org" },
        sameAs: [SU_MEMBERSHIP_URL],
      },
      {
        "@type": "WebApplication",
        "@id": ids.webApp,
        name: `${SITE_NAME} members' portal`,
        url: `${SITE_URL}/portal`,
        description:
          "The club's walk programme with route maps and elevation profiles, kit hire, The Navigator magazine and walk-leader tools, signed in with a UCL account.",
        applicationCategory: "SportsApplication",
        operatingSystem: "Any (web browser)",
        inLanguage: "en-GB",
        provider: { "@id": ids.club },
        creator: { "@id": ids.adam },
        publisher: { "@id": ids.maybeItsSoftware },
      },
      {
        "@type": "MobileApplication",
        "@id": ids.mobileApp,
        name: SITE_NAME,
        description:
          "Every walk on the programme, the club's routes, club kit, The Navigator and your own hiking year, signed in with your UCL account.",
        applicationCategory: "SportsApplication",
        operatingSystem: "iOS, Android",
        downloadUrl: "https://apps.apple.com/gb/app/ucl-hiking-club/id6808703192",
        installUrl: "https://play.google.com/store/apps/details?id=org.uclhiking.app",
        sameAs: ["https://apps.apple.com/gb/app/ucl-hiking-club/id6808703192", "https://play.google.com/store/apps/details?id=org.uclhiking.app"],
        offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
        inLanguage: "en-GB",
        provider: { "@id": ids.club },
        creator: { "@id": ids.adam },
        publisher: { "@id": ids.maybeItsSoftware },
      },
      adam,
      maybeItsSoftware,
    ],
  };
}

/** Home > page, for the public sub-pages. */
export function breadcrumbs(name: string, path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name, item: `${SITE_URL}${path}` },
    ],
  };
}
