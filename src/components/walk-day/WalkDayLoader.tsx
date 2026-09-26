"use client";

import dynamic from "next/dynamic";

// The register lives in localStorage, which the server can't see, so it renders
// on the phone only and reads its offline copy on first paint.
const WalkDay = dynamic(() => import("./WalkDay"), {
  ssr: false,
  loading: () => (
    <div className="skeleton-list" aria-label="Loading the register">
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  ),
});

export function WalkDayLoader({ eventId }: { eventId: string }) {
  return <WalkDay eventId={eventId} />;
}
