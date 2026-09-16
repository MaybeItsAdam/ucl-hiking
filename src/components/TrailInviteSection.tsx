import { SignInButton } from "@/components/SignInButton";
import Link from "next/link";

/**
 * Picks the hero's winding trail up where it leaves the bottom of ZoomedLogoHero and
 * carries it down into a single sign-in invitation.
 *
 * Three things keep the join seamless:
 *  - The background is #2c3e50, the hero mountain silhouette's fill. The hero's
 *    `xMidYMax slice` guarantees that fill is what sits at its bottom edge, so the two
 *    sections read as one continuous surface rather than two stacked panels.
 *  - Both trails descend on their viewBox's horizontal centre line (800 of 1600 on
 *    desktop, 300 of 600 on mobile), which maps to the element's centre at any scale.
 *  - These SVGs use `preserveAspectRatio="none"`, so viewBox coordinates are pure
 *    fractions of the section box: y = 0 is exactly the top edge, with no letterboxing
 *    to push the trail inward. That is also why the beacon is a positioned DOM element
 *    rather than an SVG circle — `none` would squash a circle into an ellipse, whereas a
 *    percentage-positioned element lands on the path end exactly and stays round.
 *
 * The paths start slightly above y = 0 purely as insurance against subpixel seams; the
 * section's overflow: hidden trims the excess.
 *
 * Desktop/mobile SVGs swap at the same 768px breakpoint as the hero's two stages.
 */

// Desktop: drops in on the centre line, peels out to the right-hand margin — kept clear
// of the content column by .trail-invite-inner's max-width — then curls back down.
const DESKTOP_TRAIL =
  "M 800 -60 L 800 56 C 800 112, 910 128, 1050 148 C 1250 176, 1400 232, 1392 330 C 1384 414, 1288 466, 1160 496";
const DESKTOP_BEACON = { x: 1160 / 1600, y: 496 / 600 };

// Mobile: same descent, then down the left gutter that .trail-invite-section reserves
// for it with extra padding-left.
const MOBILE_TRAIL =
  "M 300 -60 L 300 60 C 300 96, 180 104, 120 140 C 76 168, 58 212, 64 268 C 70 330, 96 386, 88 452";
const MOBILE_BEACON = { x: 88 / 600, y: 452 / 600 };

function TrailBeacon({
  position,
  className,
}: {
  position: { x: number; y: number };
  className: string;
}) {
  return (
    <span
      className={`invite-trail-beacon ${className}`}
      style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }}
      aria-hidden="true"
    >
      {/* The bounce animation sits on this inner element so its CSS transform cannot
          clobber the wrapper's centring translate. */}
      <span className="trail-bottom-beacon">
        <svg viewBox="-10 -10 20 20" width="20" height="20">
          <circle cx="0" cy="0" r="9" fill="#bdf271" />
          <polygon points="-4.5,-3 4.5,-3 0,4.5" fill="#2c3e50" />
        </svg>
      </span>
    </span>
  );
}

export function TrailInviteSection() {
  return (
    <section
      id="join"
      className="trail-invite-section"
      aria-labelledby="trail-invite-heading"
    >
      <svg
        className="invite-trail-svg invite-trail-desktop"
        viewBox="0 0 1600 600"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d={DESKTOP_TRAIL} fill="none" className="hero-winding-trail" />
      </svg>
      <TrailBeacon position={DESKTOP_BEACON} className="invite-trail-desktop" />

      <svg
        className="invite-trail-svg invite-trail-mobile"
        viewBox="0 0 600 600"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d={MOBILE_TRAIL} fill="none" className="hero-winding-trail" />
      </svg>
      <TrailBeacon position={MOBILE_BEACON} className="invite-trail-mobile" />

      <div className="trail-invite-inner">
        <p className="invite-eyebrow">The trail starts here</p>
        <h2 id="trail-invite-heading">Sign in to join the walk</h2>
        <p className="invite-copy">
          Your UCL account gets you the walk calendar, kit hire and trip sign-ups.
          One tap and you are on the list.
        </p>
        <div className="invite-actions">
          <SignInButton />
        </div>
        <Link className="invite-privacy-link" href="/privacy">Privacy policy</Link>
      </div>
    </section>
  );
}
