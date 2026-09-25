"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Map as LeafletMap } from "leaflet";
import { DIFFICULTY_LABELS, formatKm } from "@/lib/eventDetails";
import type { MapHike } from "@/lib/hikeMap";

// OpenStreetMap's own tiles: no key, attribution required, and light use like
// a club's is within their tile policy. CSS quietens them to sit on the page
// and inverts them for the dark theme (see .hike-map in globals.css).
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

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

/**
 * Walks on a map. `interactive` is the year map: numbered pins that open a
 * card, and a map you can pan and zoom. Without it, it is a picture of one
 * walk for its event page — start and finish labelled, nothing to catch a
 * scrolling thumb.
 */
export function HikeMap({ hikes, interactive = false, label }: { hikes: MapHike[]; interactive?: boolean; label: string }) {
  const container = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let map: LeafletMap | null = null;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled) return;
      map = L.map(el, {
        attributionControl: true,
        zoomControl: interactive,
        dragging: interactive,
        touchZoom: interactive,
        scrollWheelZoom: false,
        doubleClickZoom: interactive,
        boxZoom: false,
        keyboard: interactive,
      });
      map.attributionControl.setPrefix(false);

      L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);

      const points: [number, number][] = [];
      for (const hike of hikes) {
        // "Coming up" is for telling walks apart on the year map; one walk is just that walk.
        const tone = `is-${hike.difficulty ?? "none"}${interactive && hike.upcoming ? " is-upcoming" : ""}`;
        const start = hike.start ?? hike.finish!;
        const finish = hike.start && hike.finish && !same(hike.start, hike.finish) ? hike.finish : null;
        points.push(start);

        if (finish) {
          points.push(finish);
          L.polyline([start, finish], { className: `hike-route ${tone}`, weight: 3, dashArray: "1 7", lineCap: "round", interactive: false }).addTo(map);
          const end = L.marker(finish, {
            icon: L.divIcon({ className: "", html: `<span class="hike-end ${tone}"></span>`, iconSize: [14, 14], iconAnchor: [7, 7] }),
            keyboard: false,
            interactive: false,
          }).addTo(map);
          if (!interactive && hike.finishName) {
            end.bindTooltip(escape(hike.finishName), { permanent: true, direction: "right", offset: [8, 0], className: "hike-tip" });
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
          pin.bindTooltip(escape(hike.startName), { permanent: true, direction: finish && finish[1] > start[1] ? "left" : "right", offset: finish && finish[1] > start[1] ? [-10, 0] : [10, 0], className: "hike-tip" });
        }
      }

      if (points.length === 1) map.setView(points[0], 12);
      else if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 12 });
      else map.setView([51.3, -0.3], 8);
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
    };
  }, [hikes, interactive, router]);

  return (
    <div
      ref={container}
      className={`hike-map${interactive ? " is-interactive" : ""}`}
      role="region"
      aria-label={label}
      // Panning the map is not a swipe to the next tab or a pull to refresh.
      data-no-swipe={interactive ? "" : undefined}
    />
  );
}
