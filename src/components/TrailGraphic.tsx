import { ArrowUpRight, MapPin } from "lucide-react";

export function TrailGraphic() {
  return (
    <div className="trail-graphic" aria-label="UCL Hiking Club members together on a weekend hike">
      <div className="featured-tag">2,700 members last year</div>
      <div className="featured-walk-card">
        <div>
          <span><MapPin size={14} /> London &amp; beyond</span>
          <h3>Find your people outdoors</h3>
          <p>Weekend hikes, weekly socials and termly trips</p>
        </div>
        <span className="round-arrow"><ArrowUpRight size={20} /></span>
      </div>
    </div>
  );
}
