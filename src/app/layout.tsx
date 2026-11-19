import type { Metadata } from "next";
import { NativeAuthBridge } from "@/components/NativeAuthBridge";
import { KitLinkBridge } from "@/components/KitLinkBridge";
import { NativeSystemBars } from "@/components/NativeSystemBars";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ServiceWorker } from "@/components/ServiceWorker";
import { IS_PREVIEW, SITE_NAME, SITE_URL } from "@/lib/seo";
import { themeScript } from "@/lib/theme";
import "./globals.css";

const googleVerification = process.env.GOOGLE_SITE_VERIFICATION;
const bingVerification = process.env.BING_SITE_VERIFICATION;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "UCL Hiking Club — London out, wild in",
  description: "Weekend walks, mountain weekends and good company. Open to every UCL student.",
  applicationName: SITE_NAME,
  openGraph: { siteName: SITE_NAME, locale: "en_GB", type: "website" },
  twitter: { card: "summary_large_image" },
  // Previews never get indexed; ucl-hiking.vercel.app is kept out by robots.ts
  // and the X-Robots-Tag header in next.config.ts.
  ...(IS_PREVIEW ? { robots: { index: false, follow: false } } : {}),
  // Optional HTML-tag verification for Search Console / Bing Webmaster (DNS works too).
  verification: {
    ...(googleVerification ? { google: googleVerification } : {}),
    ...(bingVerification ? { other: { "msvalidate.01": bingVerification } } : {}),
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets pages reach under the notch and home indicator in the iOS app, and makes
  // env(safe-area-inset-*) report real values so they can pad around them. The
  // Android app draws edge to edge too, and supplies its insets itself.
  viewportFit: "cover",
  colorScheme: "light dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <NativeAuthBridge />
        <KitLinkBridge />
        <NativeSystemBars />
        {children}
        <OfflineBanner />
        <ServiceWorker />
      </body>
    </html>
  );
}
