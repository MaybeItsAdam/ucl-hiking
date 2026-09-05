import { ArrowUpRight, CalendarDays, MapPin, Route } from "lucide-react";
import type { Walk } from "@/lib/types";

const difficultyLabel = {
  easy: "Beginner",
  moderate: "Moderate",
  challenging: "Challenging",
};

export function WalkCard({ walk, accent }: { walk: Walk; accent: string }) {
  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(walk.starts_at));

  return (
    <article className="walk-card" style={{ "--walk-accent": accent } as React.CSSProperties}>
      <div className="walk-card-top">
        <span className={`difficulty ${walk.difficulty}`}>{difficultyLabel[walk.difficulty]}</span>
        <ArrowUpRight size={20} />
      </div>
      <h3>{walk.title}</h3>
      <p className="walk-place"><MapPin size={15} /> {walk.location}</p>
      <div className="walk-stats">
        <span><CalendarDays size={16} /><strong>{date}</strong></span>
        <span><Route size={16} /><strong>{walk.distance_km} km</strong></span>
      </div>
      <div className="spaces-row">
        <span>{walk.spaces_remaining} spaces left</span>
        <span>{walk.ascent_m}m ascent</span>
      </div>
      <div className="capacity"><i style={{ width: `${Math.max(8, (walk.spaces_remaining / walk.capacity) * 100)}%` }} /></div>
    </article>
  );
}
