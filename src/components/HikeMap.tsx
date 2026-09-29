"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LocateFixed, Maximize2, Minimize2 } from "lucide-react";
import type { CircleMarker, Circle, Control, Map as LeafletMap, Marker, TileLayer } from "leaflet";
import { DIFFICULTY_LABELS, formatKm } from "@/lib/eventDetails";
import type { MapRoute } from "@/lib/eventRoutes";
import type { MapHike } from "@/lib/hikeMap";

/**
 * Two free base maps, neither needing a key:
 *
 * - OpenStreetMap's own tiles. Their tile policy allows light use like a
 *   club's with visible attribution, a real Referer (the site and the app's
 *   web view both send one) and no bulk or offline downloading.
 * - OpenTopoMap: OSM data drawn as a topographic map with contours and hill
 *   shading from SRTM, which is what a walker wants. CC-BY-SA, free to embed
 *   as long as the server isn't hammered; it only draws to zoom 17.
 *
 * CSS quietens the street map to sit on the page and inverts both for the
 * dark theme (see .hike-map in globals.css).
 */
const BASES = {
  topo: {
    label: "Topo",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxZoom: 17,
    attribution:
      'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM · Style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
  },
  street: {
    label: "Street",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: "",
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
} as const;
type Base = keyof typeof BASES;
const BASE_KEY = "hike-map-base";

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function popup(hike: MapHike): string {
  const facts = [
    hike.distanceKm ? formatKm(hike.distanceKm) : null,
    hike.ascentM ? `${hike.ascentM.toLocaleString("en-GB")} m up` : null,
    hike.difficulty ? DIFFICULTY_LABELS[hike.difficulty] : null,
  ].filter(Boolean);
  const route = hike.finishName && hike.finishName !== hike.startName
    ? `${hike.startName ?? "?"} → ${hike.finishName}`
    : hike.startName ? `${hike.startName} circular` : "";
  return `
    <div class="hike-popup">
      <span class="hike-popup-date">#${hike.n} · ${escape(hike.dateLabel)}${hike.upcoming ? " · coming up" : ""}</span>
      <strong>${escape(hike.name)}</strong>
      ${route ? `<span>${escape(route)}</span>` : ""}
      ${facts.length ? `<span class="hike-popup-facts">${escape(facts.join(" · "))}</span>` : ""}
      <a href="/portal/events/${encodeURIComponent(hike.id)}" data-nav>Open event →</a>
    </div>`;
}

const same = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4;
/** Within ~60 m: a circular walk's two ends. */
const near = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 6e-4 && Math.abs(a[1] - b[1]) < 9e-4;

/** The member's last pick of base map, remembered across maps. */
function savedBase(): Base | null {
  try {
    const saved = localStorage.getItem(BASE_KEY);
    return saved === "topo" || saved === "street" ? saved : null;
  } catch {
    return null;
  }
}

/**
 * Walks on a map. `interactive` is the year map: numbered pins that open a
 * card, and a map you can pan and zoom. Without it, it is one walk for its
 * event page: its GPX route if it has one, and the stations labelled.
 *
 * A walk with a route is a real map: zoom buttons, pinch, and your own
 * position on it. On a phone one finger still scrolls the page (two move the
 * map, as in Google Maps), so a thumb heading down the page isn't caught.
 * Without a route it stays a still picture until opened full screen.
 */
export function HikeMap({
  hikes,
  interactive = false,
  route = null,
  label,
}: {
  hikes: MapHike[];
  interactive?: boolean;
  route?: MapRoute | null;
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<Partial<Record<Base, TileLayer>>>({});
  const zoomRef = useRef<Control.Zoom | null>(null);
  const router = useRouter();
  // A route is walked on contours; the year's pins read better on the plain map.
  const defaultBase: Base = route ? "topo" : "street";
  const [chosen, setChosen] = useState<Base | null>(null);
  const base = chosen ?? defaultBase;
  const [expanded, setExpanded] = useState(false);
  const [ready, setReady] = useState(false);
  const [hint, setHint] = useState(false);
  const [locating, setLocating] = useState<"off" | "finding" | "on" | "denied">("off");
  const meRef = useRef<{ dot: CircleMarker; ring: Circle } | null>(null);
  const walkMap = !interactive && Boolean(route);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let map: LeafletMap | null = null;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled) return;
      const saved = savedBase();
      if (saved) setChosen(saved);
      // Handlers are set per mode by the effect below; start still.
      map = L.map(el, {
        attributionControl: true,
        zoomControl: false,
        dragging: interactive,
        touchZoom: interactive || Boolean(route),
        scrollWheelZoom: false,
        doubleClickZoom: interactive,
        boxZoom: false,
        keyboard: interactive,
        // Quarter steps let a route fill its frame rather than jump a whole level smaller.
        zoomSnap: route ? 0.25 : 1,
      });
      zoomRef.current = L.control.zoom({ position: "topleft" });
      if (interactive || route) zoomRef.current.addTo(map);
      map.attributionControl.setPrefix(false);
      mapRef.current = map;

      layersRef.current = {};
      for (const key of Object.keys(BASES) as Base[]) {
        const b = BASES[key];
        layersRef.current[key] = L.tileLayer(b.url, { attribution: b.attribution, maxZoom: b.maxZoom, subdomains: b.subdomains || "abc" });
      }

      const points: [number, number][] = [];
      let startMarker: Marker | null = null;

      if (route) {
        for (const seg of route.segments) {
          // A pale casing under the line keeps it readable over contours and woods.
          L.polyline(seg, { className: "hike-track-casing", weight: 7, lineCap: "round", lineJoin: "round", interactive: false }).addTo(map);
          L.polyline(seg, { className: "hike-track", weight: 4, lineCap: "round", lineJoin: "round", interactive: false }).addTo(map);
          points.push(...seg);
        }
        // Unnamed waypoints are a route planner's clicks, not places: skip them.
        for (const w of route.waypoints) {
          if (!w.name?.trim()) continue;
          L.marker(w.at, {
            icon: L.divIcon({ className: "", html: '<span class="hike-waypoint"></span>', iconSize: [10, 10], iconAnchor: [5, 5] }),
            keyboard: false,
          })
            .addTo(map)
            .bindTooltip(escape(w.name), { direction: "top", offset: [0, -6], className: "hike-tip" });
        }
        const loop = near(route.start, route.finish);
        // End labels sit above or below their marker, on the side away from the
        // rest of the walk, so they neither cross the line nor run off the edge.
        const finishNorth = route.finish[0] >= route.start[0];
        const below = (up: boolean) => (up ? { direction: "top" as const, offset: [0, -10] as [number, number] } : { direction: "bottom" as const, offset: [0, 10] as [number, number] });
        if (!loop) {
          L.marker(route.finish, {
            icon: L.divIcon({ className: "", html: '<span class="hike-track-end"></span>', iconSize: [16, 16], iconAnchor: [8, 8] }),
            keyboard: false,
            interactive: false,
          })
            .addTo(map)
            .bindTooltip("Finish", { permanent: true, ...below(finishNorth), className: "hike-tip" });
        }
        startMarker = L.marker(route.start, {
          icon: L.divIcon({ className: "", html: '<span class="hike-track-start"></span>', iconSize: [16, 16], iconAnchor: [8, 8] }),
          keyboard: false,
          interactive: false,
          zIndexOffset: 500,
        })
          .addTo(map)
          .bindTooltip(loop ? "Start and finish" : "Start", { permanent: true, ...below(loop || !finishNorth), className: "hike-tip" });
      }
      let meetPin: { marker: Marker; name: string } | null = null;

      // With a route, the stations are where to meet; far-off ones (a London terminus) don't widen the view.
      const routeBounds = points.length ? L.latLngBounds(points).pad(0.6) : null;

      for (const hike of hikes) {
        // "Coming up" is for telling walks apart on the year map; one walk is just that walk.
        const tone = `is-${hike.difficulty ?? "none"}${interactive && hike.upcoming ? " is-upcoming" : ""}`;
        const start = hike.start ?? hike.finish!;
        const finish = hike.start && hike.finish && !same(hike.start, hike.finish) ? hike.finish : null;
        const counts = (p: [number, number]) => !routeBounds || routeBounds.contains(p);
        if (counts(start)) points.push(start);

        if (finish) {
          if (counts(finish)) points.push(finish);
          if (!route) {
            L.polyline([start, finish], { className: `hike-route ${tone}`, weight: 3, dashArray: "1 7", lineCap: "round", interactive: false }).addTo(map);
          }
          const end = L.marker(finish, {
            icon: L.divIcon({ className: "", html: `<span class="hike-end ${tone}"></span>`, iconSize: [14, 14], iconAnchor: [7, 7] }),
            keyboard: false,
            interactive: false,
          }).addTo(map);
          if (!interactive && hike.finishName) {
            end.bindTooltip(escape(hike.finishName), { permanent: !route, direction: "right", offset: [8, 0], className: "hike-tip" });
          }
        }

        const pin = L.marker(start, {
          icon: L.divIcon({
            className: "",
            html: `<span class="hike-pin ${tone}">${interactive ? hike.n : ""}</span>`,
            iconSize: interactive ? [28, 28] : [18, 18],
            iconAnchor: interactive ? [14, 14] : [9, 9],
          }),
          title: interactive ? `${hike.n}. ${hike.name}` : undefined,
          keyboard: interactive,
          interactive,
          riseOnHover: true,
        }).addTo(map);
        if (interactive) pin.bindPopup(popup(hike), { closeButton: false, maxWidth: 260, offset: [0, -8] });
        else if (hike.startName) {
          if (route && !meetPin) meetPin = { marker: pin, name: hike.startName };
          const left = finish && finish[1] > start[1];
          // With a route, the station's label sits on the same side as Start's, so the two merge (below) rather than collide.
          const up = route ? !(route.finish[0] >= route.start[0]) || near(route.start, route.finish) : false;
          pin.bindTooltip(escape(route ? `Meet: ${hike.startName}` : hike.startName), {
            permanent: true,
            className: "hike-tip",
            ...(route
              ? { direction: up ? "top" : "bottom", offset: [0, up ? -10 : 10] as [number, number] }
              : { direction: left ? "left" : "right", offset: (left ? [-10, 0] : [10, 0]) as [number, number] }),
          });
        }
      }

      if (points.length === 1) map.setView(points[0], 12);
      // A route's labels hang off its ends: leave them room inside the frame.
      else if (points.length) map.fitBounds(L.latLngBounds(points), { padding: route ? [48, 40] : [28, 28], maxZoom: route ? 15 : 12 });
      else map.setView([51.3, -0.3], 8);

      // A station drawn right by the route's start shares its label rather than printing over it.
      if (route && startMarker && meetPin) {
        const a = map.latLngToContainerPoint(startMarker.getLatLng());
        const b = map.latLngToContainerPoint(meetPin.marker.getLatLng());
        if (Math.abs(a.x - b.x) < 140 && Math.abs(a.y - b.y) < 28) {
          meetPin.marker.unbindTooltip();
          const ends = near(route.start, route.finish) ? "Start and finish" : "Start";
          startMarker.setTooltipContent(escape(`${ends} · meet at ${meetPin.name}`));
        }
      }
      setReady(true);
    });

    // Popup links are HTML Leaflet draws, so route them through the app ourselves.
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>("a[data-nav]");
      if (!link) return;
      event.preventDefault();
      router.push(link.getAttribute("href")!);
    };
    el.addEventListener("click", onClick);

    return () => {
      cancelled = true;
      el.removeEventListener("click", onClick);
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [hikes, interactive, route, router]);

  // Swap base maps without redrawing the rest.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const [key, layer] of Object.entries(layersRef.current) as [Base, TileLayer][]) {
      if (key === base) {
        if (!map.hasLayer(layer)) layer.addTo(map);
      } else if (map.hasLayer(layer)) map.removeLayer(layer);
    }
    const max = BASES[base].maxZoom;
    if (map.getZoom() > max) map.setZoom(max);
  }, [base, ready]);

  // Full screen, everything moves the map. On the page a route map pans with a
  // mouse and pinches with two fingers; one finger is left to scroll the page.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || interactive) return;
    const fine = window.matchMedia("(pointer: fine)").matches;
    const drag = expanded || (walkMap && fine);
    for (const handler of [map.dragging, map.doubleClickZoom, map.keyboard]) {
      if (drag || (walkMap && handler !== map.dragging)) handler.enable();
      else handler.disable();
    }
    if (expanded || walkMap) map.touchZoom.enable();
    else map.touchZoom.disable();
    if (expanded) map.scrollWheelZoom.enable();
    else map.scrollWheelZoom.disable();
    const zoom = zoomRef.current;
    if (zoom) {
      if (drag || walkMap) zoom.addTo(map);
      else zoom.remove();
    }
    map.invalidateSize();
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded, ready, interactive, route, walkMap]);

  // One finger dragging a route map on the page: say how to move it.
  useEffect(() => {
    const el = container.current;
    if (!el || !walkMap || expanded) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return setHint(false);
      setHint(true);
      clearTimeout(timer);
      timer = setTimeout(() => setHint(false), 1400);
    };
    el.addEventListener("touchmove", onMove, { passive: true });
    return () => {
      clearTimeout(timer);
      el.removeEventListener("touchmove", onMove);
    };
  }, [walkMap, expanded]);

  // Your own position, while the button is on. Nothing is sent anywhere.
  const watching = locating === "finding" || locating === "on";
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !watching) return;
    let first = true;
    let cancelled = false;
    const watch = navigator.geolocation.watchPosition(
      async (pos) => {
        if (cancelled) return;
        const L = await import("leaflet");
        const at: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        if (!meRef.current) {
          meRef.current = {
            ring: L.circle(at, { radius: pos.coords.accuracy, className: "hike-me-ring", interactive: false }).addTo(map),
            dot: L.circleMarker(at, { radius: 7, className: "hike-me", interactive: false }).addTo(map),
          };
        } else {
          meRef.current.dot.setLatLng(at);
          meRef.current.ring.setLatLng(at).setRadius(pos.coords.accuracy);
        }
        if (first) {
          first = false;
          setLocating("on");
          // Near the walk: keep the walk in view with you on it. Far away: just show where you are.
          const bounds = map.getBounds();
          if (bounds.pad(1).contains(at)) map.fitBounds(bounds.extend(at), { padding: [24, 24], maxZoom: map.getZoom() });
          else map.setView(at, 14);
        }
      },
      () => !cancelled && setLocating("denied"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watch);
    };
  }, [ready, watching]);

  function toggleLocate() {
    if (watching) {
      setLocating("off");
      meRef.current?.dot.remove();
      meRef.current?.ring.remove();
      meRef.current = null;
    } else setLocating("geolocation" in navigator ? "finding" : "denied");
  }

  function pick(next: Base) {
    setChosen(next);
    try {
      localStorage.setItem(BASE_KEY, next);
    } catch {}
  }

  return (
    <div className={`hike-map-wrap${interactive ? " is-interactive" : ""}${walkMap ? " has-route" : ""}${expanded ? " is-expanded" : ""}`}>
      <div
        ref={container}
        className={`hike-map is-${base}${interactive ? " is-interactive" : ""}`}
        role="region"
        aria-label={label}
        // Panning the map is not a swipe to the next tab or a pull to refresh.
        data-no-swipe={interactive || expanded || route ? "" : undefined}
      />
      {hint ? (
        <p className="hike-map-hint" aria-hidden="true">
          Use two fingers to move the map
        </p>
      ) : null}
      {locating === "denied" ? (
        <p className="hike-map-note" role="status">
          Location is off for this app. Turn it on in Settings to see yourself on the map.
        </p>
      ) : null}
      <div className="hike-map-controls">
        <div className="hike-map-bases" role="group" aria-label="Map style">
          {(Object.keys(BASES) as Base[]).map((key) => (
            <button key={key} type="button" aria-pressed={base === key} onClick={() => pick(key)}>
              {BASES[key].label}
            </button>
          ))}
        </div>
        {walkMap ? (
          <button
            type="button"
            className={`hike-map-expand${locating === "finding" ? " is-finding" : ""}`}
            aria-pressed={watching}
            aria-label={watching ? "Stop showing my location" : "Show my location"}
            onClick={toggleLocate}
          >
            <LocateFixed size={16} aria-hidden="true" />
          </button>
        ) : null}
        {!interactive ? (
          <button
            type="button"
            className="hike-map-expand"
            aria-pressed={expanded}
            aria-label={expanded ? "Close full-screen map" : "Open map full screen"}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
          </button>
        ) : null}
      </div>
    </div>
  );
}
