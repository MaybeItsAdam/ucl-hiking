"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Mountain } from "lucide-react";
import { ElevationProfile } from "@/components/ElevationProfile";
import { HikeMap } from "@/components/HikeMap";
import type { MapRoute } from "@/lib/eventRoutes";
import type { MapHike } from "@/lib/hikeMap";
import { routeLengthKm } from "@/lib/routeAlong";

// Only fetched once the 3D view is first asked for: the terrain renderer is heavy
// and most visits never open it.
const HikeMap3D = dynamic(() => import("@/components/HikeMap3D"), {
  ssr: false,
  loading: () => <div className="map3d-loading">Loading 3D…</div>,
});

const THREE_D_KEY = "hike-map-3d";

/** Same-tab writes don't fire `storage`, so the toggle sets its own state too. */
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function saved3D(): boolean {
  try {
    return localStorage.getItem(THREE_D_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The event page's route: the 2D map, an optional 3D view of the same line,
 * and the elevation strip, sharing one "where along the walk" so scrubbing the
 * strip moves the marker in 3D and the other way round.
 *
 * `children` sit between the maps and the strip (the page's route facts).
 */
export function RouteView({
  hikes,
  route,
  label,
  children,
}: {
  hikes: MapHike[];
  route: MapRoute | null;
  label: string;
  children?: ReactNode;
}) {
  // Off on the server and for first paint, then the member's last choice.
  const remembered = useSyncExternalStore(subscribe, saved3D, () => false);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const show3D = Boolean(route) && (chosen ?? remembered);
  /** km along the walk as the elevation strip measures it, or null. */
  const [along, setAlong] = useState<number | null>(null);

  // The strip measures the full GPX; the drawn line is thinned (and its
  // segments joined without the gaps), so it runs a touch shorter. Scale
  // between the two so a km on the strip lands at the same place on the line.
  const profile = route?.profile ?? [];
  const profileKm = profile.length ? profile[profile.length - 1][0] : 0;
  const lineKm = useMemo(() => (route ? routeLengthKm(route.segments) : 0), [route]);
  const scale = profileKm > 0 && lineKm > 0 ? lineKm / profileKm : 1;

  const toggle = () => {
    const next = !show3D;
    setChosen(next);
    try {
      localStorage.setItem(THREE_D_KEY, next ? "1" : "0");
    } catch {
      // Private mode: the choice just isn't remembered.
    }
  };

  return (
    <>
      <HikeMap hikes={hikes} route={route} label={label} />
      {route ? (
        <>
          <div className="route-view-bar">
            <button type="button" className="kit-btn route-view-3d" aria-pressed={show3D} onClick={toggle}>
              <Mountain size={15} aria-hidden="true" />
              3D
            </button>
          </div>
          {show3D ? (
            <div className="route-view-3d-wrap">
              <HikeMap3D
                route={route}
                label={`3D map of ${label.replace(/^Map of /, "")}`}
                along={along === null ? null : along * scale}
                onAlong={(km: number | null) => setAlong(km === null ? null : km / scale)}
              />
            </div>
          ) : null}
        </>
      ) : null}
      {children}
      {route?.profile.length ? <ElevationProfile profile={route.profile} at={along} onScrub={setAlong} /> : null}
    </>
  );
}
