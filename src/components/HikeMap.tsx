"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Maximize2, Minimize2 } from "lucide-react";
import type { Control, Map as LeafletMap, TileLayer } from "leaflet";
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
 * event page: its GPX route if it has one, the stations labelled, and still
 * enough that a scrolling thumb isn't caught; "Expand" opens it full screen
 * to pan and pinch.
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

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let map: LeafletMap | null = null;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled) return;
      const saved = savedBase();
      if (saved) setChosen(saved);
      // Still on the page (see the full-screen effect below for when it wakes up), free on the year map.
      map = L.map(el, {
        attributionControl: true,
        zoomControl: false,
        dragging: interactive,
        touchZoom: interactive,
        scrollWheelZoom: false,
        doubleClickZoom: interactive,
        boxZoom: false,
        keyboard: interactive,
      });
      zoomRef.current = L.control.zoom({ position: "topleft" });
      if (interactive) zoomRef.current.addTo(map);
      map.attributionControl.setPrefix(false);
      mapRef.current = map;

      layersRef.current = {};
      for (const key of Object.keys(BASES) as Base[]) {
        const b = BASES[key];
        layersRef.current[key] = L.tileLayer(b.url, { attribution: b.attribution, maxZoom: b.maxZoom, subdomains: b.subdomains || "abc" });
      }

      const points: [number, number][] = [];

      if (route) {
        for (const seg of route.segments) {
          // A pale casing under the line keeps it readable over contours and woods.
          L.polyline(seg, { className: "hike-track-casing", weight: 7, lineCap: "round", lineJoin: "round", interactive: false }).addTo(map);
          L.polyline(seg, { className: "hike-track", weight: 4, lineCap: "round", lineJoin: "round", interactive: false }).addTo(map);
          points.push(...seg);
        }
        for (const w of route.waypoints) {
          const dot = L.marker(w.at, {
            icon: L.divIcon({ className: "", html: '<span class="hike-waypoint"></span>', iconSize: [10, 10], iconAnchor: [5, 5] }),
            keyboard: false,
            interactive: Boolean(w.name),
          }).addTo(map);
          if (w.name) dot.bindTooltip(escape(w.name), { direction: "top", offset: [0, -6], className: "hike-tip" });
        }
        const loop = near(route.start, route.finish);
        if (!loop) {
          L.marker(route.finish, {
            icon: L.divIcon({ className: "", html: '<span class="hike-track-end"></span>', iconSize: [16, 16], iconAnchor: [8, 8] }),
            keyboard: false,
            interactive: false,
          })
            .addTo(map)
            .bindTooltip("Finish", { permanent: true, direction: "right", offset: [9, 0], className: "hike-tip" });
        }
        L.marker(route.start, {
          icon: L.divIcon({ className: "", html: '<span class="hike-track-start"></span>', iconSize: [16, 16], iconAnchor: [8, 8] }),
          keyboard: false,
          interactive: false,
          zIndexOffset: 500,
        })
          .addTo(map)
          .bindTooltip(loop ? "Start and finish" : "Start", { permanent: true, direction: "left", offset: [-9, 0], className: "hike-tip" });
      }

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
          const left = finish && finish[1] > start[1];
          pin.bindTooltip(escape(route ? `Meet: ${hike.startName}` : hike.startName), {
            permanent: true,
            direction: left ? "left" : "right",
            offset: left ? [-10, 0] : [10, 0],
            className: "hike-tip",
          });
        }
      }

      if (points.length === 1) map.setView(points[0], 12);
      else if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: route ? 15 : 12 });
      else map.setView([51.3, -0.3], 8);
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

  // On the page a mouse may pan and zoom a route (it traps nobody); a thumb
  // gets that only full screen, where pinch and wheel zoom join in too.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || interactive) return;
    const fine = window.matchMedia("(pointer: fine)").matches;
    const live = expanded || (Boolean(route) && fine);
    for (const handler of [map.dragging, map.doubleClickZoom, map.keyboard]) {
      if (live) handler.enable();
      else handler.disable();
    }
    for (const handler of [map.touchZoom, map.scrollWheelZoom]) {
      if (expanded) handler.enable();
      else handler.disable();
    }
    const zoom = zoomRef.current;
    if (zoom) {
      if (live) zoom.addTo(map);
      else zoom.remove();
    }
    map.invalidateSize();
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded, ready, interactive, route]);

  function pick(next: Base) {
    setChosen(next);
    try {
      localStorage.setItem(BASE_KEY, next);
    } catch {}
  }

  return (
    <div className={`hike-map-wrap${interactive ? " is-interactive" : ""}${expanded ? " is-expanded" : ""}`}>
      <div
        ref={container}
        className={`hike-map is-${base}${interactive ? " is-interactive" : ""}`}
        role="region"
        aria-label={label}
        // Panning the map is not a swipe to the next tab or a pull to refresh.
        data-no-swipe={interactive || expanded || route ? "" : undefined}
      />
      <div className="hike-map-controls">
        <div className="hike-map-bases" role="group" aria-label="Map style">
          {(Object.keys(BASES) as Base[]).map((key) => (
            <button key={key} type="button" aria-pressed={base === key} onClick={() => pick(key)}>
              {BASES[key].label}
            </button>
          ))}
        </div>
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
