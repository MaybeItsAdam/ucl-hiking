"use client";

import { ArrowUpRight, MapPin, Compass } from "lucide-react";

export function TrailGraphic() {
  return (
    <div className="trail-graphic-shell" aria-label="UCL Hiking Club animated mountain trail illustration">
      <svg
        className="trail-svg"
        viewBox="0 0 600 650"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#dce8e6" />
            <stop offset="100%" stopColor="#c5ded9" />
          </linearGradient>
        </defs>

        {/* Sky Background */}
        <rect width="600" height="650" fill="url(#skyGrad)" />

        {/* Topographic Contour Lines */}
        <g className="topo-lines" stroke="#2f4355" strokeWidth="1" strokeOpacity="0.12" fill="none">
          <path d="M-50 120 Q 150 80, 350 140 T 650 100" />
          <path d="M-50 200 Q 200 160, 400 220 T 650 180" />
          <path d="M-50 280 Q 100 240, 300 310 T 650 260" />
          <path d="M-50 360 Q 250 300, 450 380 T 650 340" />
          <path d="M-50 440 Q 180 400, 380 460 T 650 420" />
        </g>

        {/* Distant Mountain Layer 3 */}
        <path
          d="M -50 450 L 80 280 L 220 380 L 360 220 L 520 370 L 650 250 L 650 650 L -50 650 Z"
          fill="#94b8b2"
          opacity="0.45"
        />

        {/* Midground Mountain Layer 2 */}
        <path
          d="M -50 520 L 120 320 L 260 440 L 420 260 L 580 460 L 650 380 L 650 650 L -50 650 Z"
          fill="#4c7574"
          opacity="0.75"
        />

        {/* Foreground Mountain Layer 1 */}
        <path
          d="M -50 580 L 60 410 L 180 500 L 330 330 L 480 480 L 650 390 L 650 650 L -50 650 Z"
          fill="#2f4355"
        />

        {/* Peak Accent Lines */}
        <path
          d="M 330 330 L 330 650"
          stroke="#08a8ad"
          strokeWidth="2"
          strokeDasharray="4 4"
          opacity="0.6"
        />
        <path
          d="M 420 260 L 420 650"
          stroke="#b9da3b"
          strokeWidth="2"
          strokeDasharray="4 4"
          opacity="0.4"
        />

        {/* Animated Trail Path */}
        <path
          className="animated-trail-path"
          d="M 50 600 Q 120 540 180 500 T 260 440 T 330 330 T 420 260 T 520 210"
          fill="none"
          stroke="#b9da3b"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="12 8"
        />

        {/* Summit Markers */}
        <g className="waypoint-pulse" transform="translate(330, 330)">
          <circle r="16" fill="#b9da3b" fillOpacity="0.25" className="ping-ring" />
          <circle r="8" fill="#b9da3b" stroke="#2f4355" strokeWidth="2" />
        </g>

        <g className="waypoint-pulse" transform="translate(520, 210)">
          <circle r="20" fill="#08a8ad" fillOpacity="0.3" className="ping-ring" />
          <circle r="9" fill="#08a8ad" stroke="#ffffff" strokeWidth="2.5" />
        </g>

        {/* Rotating Compass SVG in Corner */}
        <g transform="translate(510, 90)" className="rotating-compass" opacity="0.75">
          <circle r="40" stroke="#2f4355" strokeWidth="1.5" strokeDasharray="4 4" fill="none" />
          <polygon points="0,-26 7,0 0,5 -7,0" fill="#08a8ad" />
          <polygon points="0,26 7,0 0,-5 -7,0" fill="#2f4355" opacity="0.4" />
          <text x="-4" y="-30" fontSize="9" fontWeight="900" fill="#2f4355">N</text>
        </g>
      </svg>

      {/* Featured Overlay Cards */}
      <div className="featured-tag">
        <Compass size={13} className="inline-block mr-1" />
        2,700 members · Peak Adventures
      </div>

      <div className="featured-walk-card">
        <div>
          <span><MapPin size={14} /> London &amp; National Parks</span>
          <h3>Find your people outdoors</h3>
          <p>Weekend hikes, weekly socials and termly trips</p>
        </div>
        <span className="round-arrow"><ArrowUpRight size={20} /></span>
      </div>
    </div>
  );
}
