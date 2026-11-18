import { JsonLd } from "@/components/JsonLd";
import { TrailInviteSection } from "@/components/TrailInviteSection";
import { ZoomedLogoHero } from "@/components/ZoomedLogoHero";
import { homeGraph, pageMetadata, SITE_DESCRIPTION } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "UCL Hiking Club — Weekend walks from London",
  description: SITE_DESCRIPTION,
  path: "/",
});

export default function Home() {
  return (
    <main>
      <JsonLd data={homeGraph()} />
      {/* The hero draws "UCL Hiking" as hidden SVG artwork; this is the page's real
          heading and summary for screen readers, search and AI assistants. */}
      <h1 className="sr-only">UCL Hiking Club</h1>
      <p className="sr-only">{SITE_DESCRIPTION}</p>
      {/* .hero-shell clips the hero trail's deliberate overshoot past the viewBox floor
          back to exactly the section edge, where TrailInviteSection picks it up. */}
      <div className="hero-shell">
        <ZoomedLogoHero />
      </div>
      <TrailInviteSection />
    </main>
  );
}
