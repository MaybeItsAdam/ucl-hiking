import { TrailInviteSection } from "@/components/TrailInviteSection";
import { ZoomedLogoHero } from "@/components/ZoomedLogoHero";

export default function Home() {
  return (
    <main>
      {/* .hero-shell clips the hero trail's deliberate overshoot past the viewBox floor
          back to exactly the section edge, where TrailInviteSection picks it up. */}
      <div className="hero-shell">
        <ZoomedLogoHero />
      </div>
      <TrailInviteSection />
    </main>
  );
}
