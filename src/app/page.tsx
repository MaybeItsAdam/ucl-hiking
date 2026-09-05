import Link from "next/link";
import { ArrowRight, Compass, Footprints, Heart, Instagram, ShieldCheck, Sparkles } from "lucide-react";
import { Header } from "@/components/Header";
import { ClubMark } from "@/components/ClubMark";
import { SignInButton } from "@/components/SignInButton";
import { TrailGraphic } from "@/components/TrailGraphic";
import { WalkCard } from "@/components/WalkCard";
import { getPublicWalks } from "@/lib/walks";

export default async function Home() {
  const walks = await getPublicWalks();
  return (
    <main>
      <div className="hero-shell">
        <Header />
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow"><Sparkles size={14} /> Hikes every weekend</span>
            <h1>Your weekends<br />just got <em>bigger.</em></h1>
            <p>Escape the city with UCL&apos;s friendliest walking community. Day hikes, mountain weekends and a lot of questionable trail snacks.</p>
            <div className="hero-actions">
              <Link href="#walks" className="button primary">See upcoming walks <ArrowRight size={17} /></Link>
              <SignInButton />
            </div>
            <div className="social-proof">
              <div className="face-stack" aria-hidden="true"><i>MB</i><i>AS</i><i>JL</i><i>+8</i></div>
              <span><strong>2,700 members last year</strong><br />UCL&apos;s biggest club</span>
            </div>
          </div>
          <TrailGraphic />
        </section>
      </div>

      <section className="section walks-section" id="walks">
        <div className="section-heading">
          <div><span className="kicker">Pick your next horizon</span><h2>Coming up on the trail</h2></div>
          <Link href="/portal">Member walk calendar <ArrowRight size={16} /></Link>
        </div>
        <div className="walk-grid">
          {walks.map((walk, index) => <WalkCard key={walk.id} walk={walk} accent={["#d8f06f", "#fe9e72", "#9edbc4"][index]} />)}
        </div>
      </section>

      <section className="why-section" id="about">
        <div className="why-copy">
          <span className="kicker">No experience required</span>
          <h2>Fresh air is better<br />with good people.</h2>
          <p>Hikes every weekend. Socials every week. Trips every term. From gentle Discoverer walks to demanding Explorer routes, there is room to grow.</p>
          <Link href="#membership" className="text-link">Meet the club <ArrowRight size={16} /></Link>
        </div>
        <div className="benefit-grid">
          <article><span><Compass /></span><h3>Proper adventures</h3><p>Weekly day walks plus weekends across the UK.</p></article>
          <article><span><Heart /></span><h3>Your kind of people</h3><p>A welcoming crew from every course and year.</p></article>
          <article><span><ShieldCheck /></span><h3>In safe hands</h3><p>Trained leaders, thoughtful routes and clear kit lists.</p></article>
          <article><span><Footprints /></span><h3>Room to grow</h3><p>From first ramble to leading your own mountain day.</p></article>
        </div>
      </section>

      <section className="membership-section" id="membership">
        <div className="membership-card">
          <span className="kicker light">Join the club</span>
          <h2>One membership.<br />A year of good stories.</h2>
          <p>Try a free Taster event, choose Standard for our welcoming Discoverer walks, or go Explorer for every weekend route and residential trip. Your UCL account keeps access simple.</p>
          <div className="membership-actions"><SignInButton /><a href="https://studentsunionucl.org/clubs-societies/hiking-club" target="_blank" rel="noreferrer">Buy membership <ArrowRight size={16} /></a></div>
        </div>
        <div className="membership-notes">
          <span><strong>Taster</strong><small>Your first walk with us</small></span>
          <span><strong>Standard</strong><small>Discoverer walks + socials</small></span>
          <span><strong>Explorer</strong><small>Every hike + residentials</small></span>
        </div>
      </section>

      <footer><div className="brand footer-brand"><ClubMark size={38} /><span><strong>UCL Hiking</strong> Club</span></div><a className="instagram-link" href="https://www.instagram.com/uclhiking/" target="_blank" rel="noreferrer"><Instagram size={15} /> @uclhiking</a><p>Hikes every weekend. Socials every week. Trips every term.</p><span>© {new Date().getFullYear()} UCL Hiking Club</span></footer>
    </main>
  );
}
