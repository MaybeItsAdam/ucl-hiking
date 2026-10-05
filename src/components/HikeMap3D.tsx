"use client";

// Only ever loaded through next/dynamic, so this CSS lands in the 3D map's own
// chunk and not in every page's bundle.
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pause, Play } from "lucide-react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import type { MapRoute } from "@/lib/eventRoutes";
import { pointAlong, routeLengthKm } from "@/lib/routeAlong";

/**
 * Everything here is free and needs no key:
 *
 * - OpenFreeMap's "liberty" style: OpenMapTiles vector tiles of OSM data,
 *   served without limits or sign-up.
 * - AWS Terrain Tiles (the old Mapzen set, on the AWS open data registry):
 *   heights packed into PNGs as "terrarium" RGB, to zoom 15.
 *
 * The base map stays light in the dark theme: inverting a WebGL canvas is
 * not the cheap trick it is on Leaflet's tile images, and hillshade reads
 * wrongly inverted. Only the controls around it follow the theme.
 */
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const DEM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
/**
 * OpenFreeMap's tiles bring their own credit (OpenFreeMap, OpenMapTiles and
 * OpenStreetMap) into the attribution box; the heights are credited on their
 * sources, so the box shows exactly what is on screen.
 */
const DEM_ATTRIBUTION = 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen / AWS Terrain Tiles</a>';
/** Hills a touch taller than life, so a Surrey ridge still looks like one. */
const EXAGGERATION = 1.3;
/** The overview's tilt and turn: enough that the 3D is obvious at once. */
const OVERVIEW = { pitch: 60, bearing: -20 };
/** Flying along: low over the shoulder of the walker. */
const FLY = { pitch: 65, zoom: 14.6 };

type Failure = "webgl" | "load";
/** Camera events a member's own drag, pinch, twist or tilt starts with. */
const GRABS = ["dragstart", "zoomstart", "rotatestart", "pitchstart"] as const;

/** [lat, lng], as the rest of the app keeps it, to MapLibre's [lng, lat]. */
const lngLat = (p: [number, number]): [number, number] => [p[1], p[0]];

/** Compass bearing in degrees from one [lat, lng] to another. */
function bearingBetween(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180;
  const [lat1, lat2] = [a[0] * toRad, b[0] * toRad];
  const dLng = (b[1] - a[1]) * toRad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return Math.atan2(y, x) / toRad;
}

/** Turn `from` toward `to` by `t` of the way, the short way round. */
function turnToward(from: number, to: number, t: number): number {
  const diff = ((((to - from) % 360) + 540) % 360) - 180;
  return from + diff * t;
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * MapLibre 6 is ESM-only and runs its tile worker from two files of its own,
 * the worker and the code it shares with the page, which it looks for beside
 * itself; once webpack has bundled it, there's nothing there. webpack ships
 * each file as a plain asset for `new URL(…, import.meta.url)`, but under a
 * hashed name, so the worker's `import "./maplibre-gl-shared.mjs"` would miss.
 * So: fetch the worker, point that import at the shared file's real address,
 * and start the worker from the result. Once per page; every map reuses it.
 */
let workerUrl: Promise<string> | null = null;
function maplibreWorker(): Promise<string> {
  workerUrl ??= (async () => {
    const worker = new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url);
    const shared = new URL("maplibre-gl/dist/maplibre-gl-shared.mjs", import.meta.url);
    const res = await fetch(worker);
    if (!res.ok) throw new Error(`MapLibre worker: ${res.status}`);
    const source = (await res.text()).replace(/(["'`])\.\/maplibre-gl-shared\.mjs\1/g, JSON.stringify(shared.href));
    return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  })().catch((err: unknown) => {
    workerUrl = null; // Try again next time rather than remembering a failure.
    throw err;
  });
  return workerUrl;
}

const REDUCED = "(prefers-reduced-motion: reduce)";
const prefersReducedMotion = () => window.matchMedia(REDUCED).matches;
function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** A marker's element: a sized box holding one of the 2D map's end or waypoint dots. */
function markEl(inner: string, size: "end" | "point" | "along", title?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `map3d-mark is-${size}`;
  if (title) {
    el.title = title;
    el.setAttribute("aria-label", title);
    el.setAttribute("role", "img");
  } else el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<span class="${inner}"></span>`;
  return el;
}

/**
 * One walk's route on the hills it crosses: tilted, terrain raised, with a
 * "Fly along" that follows the line from start to finish and reports where it
 * is, so the elevation profile can show the same spot. `along` is the other
 * direction: the profile being scrubbed, marked here with a dot.
 *
 * On a phone one finger scrolls the page past it (MapLibre's cooperative
 * gestures); two move the map.
 */
export default function HikeMap3D({
  route,
  label,
  along = null,
  onAlong,
}: {
  route: MapRoute;
  label: string;
  along?: number | null;
  onAlong?: (km: number | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const dotRef = useRef<Marker | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  // The parent's callback changes identity on every render; the animation reads the latest.
  const onAlongRef = useRef(onAlong);
  useEffect(() => {
    onAlongRef.current = onAlong;
  }, [onAlong]);

  const [ready, setReady] = useState(false);
  // Only ever rendered in the browser (next/dynamic with ssr off), so this can look now.
  const [failed, setFailed] = useState<Failure | null>(() => (hasWebGL() ? null : "webgl"));
  const [flying, setFlying] = useState(false);
  const reduced = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);

  useEffect(() => {
    const el = container.current;
    // Hidden from the first render when there's no WebGL to draw with.
    if (!el || el.hidden) return;
    let map: MapLibreMap | null = null;
    let cancelled = false;

    Promise.all([import("maplibre-gl"), maplibreWorker()]).then(([maplibre, worker]) => {
      if (cancelled) return;
      maplibre.setWorkerUrl(worker);

      const points = route.segments.flat();
      const bounds = new maplibre.LngLatBounds();
      for (const p of points.length ? points : [route.start, route.finish]) bounds.extend(lngLat(p));
      const css = getComputedStyle(el);
      const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;

      try {
        map = new maplibre.Map({
          container: el,
          style: STYLE_URL,
          bounds,
          fitBoundsOptions: { padding: 48, maxZoom: 15 },
          maxPitch: 75,
          attributionControl: { compact: true },
          cooperativeGestures: true,
        });
      } catch {
        setFailed("webgl");
        return;
      }
      mapRef.current = map;
      const m = map;

      m.addControl(new maplibre.NavigationControl({ visualizePitch: true }), "top-left");
      m.addControl(new maplibre.TerrainControl({ source: "terrain", exaggeration: EXAGGERATION }), "top-left");

      // Tile and glyph misses also arrive as "error"; only a style that never
      // loads leaves nothing to look at.
      let loaded = false;
      m.on("error", (e) => {
        if (!loaded && !("sourceId" in e)) setFailed("load");
      });
      m.on("webglcontextlost", () => setFailed("webgl"));

      m.on("load", () => {
        loaded = true;
        // MapLibre wants terrain and hillshade on separate sources of the same tiles.
        const dem = { type: "raster-dem" as const, tiles: [DEM_TILES], tileSize: 256, maxzoom: 15, encoding: "terrarium" as const, attribution: DEM_ATTRIBUTION };
        m.addSource("terrain", dem);
        m.addSource("hillshade", dem);
        // Under the roads and labels, over the land colours.
        const firstSymbol = m.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
        m.addLayer(
          {
            id: "map3d-hillshade",
            type: "hillshade",
            source: "hillshade",
            paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#ffffff" },
          },
          firstSymbol,
        );
        m.setTerrain({ source: "terrain", exaggeration: EXAGGERATION });
        m.setSky({
          "sky-color": token("--info-line", "#ffffff"),
          "horizon-color": token("--surface", "#ffffff"),
          "fog-color": token("--surface", "#ffffff"),
          "sky-horizon-blend": 0.6,
          "horizon-fog-blend": 0.6,
          "fog-ground-blend": 0.85,
          "atmosphere-blend": 0,
        });

        m.addSource("route", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: route.segments.map((seg) => seg.map(lngLat)) } },
        });
        const line = { "line-cap": "round" as const, "line-join": "round" as const };
        // A pale casing under the line keeps it readable over woods and shading.
        m.addLayer({ id: "map3d-route-casing", type: "line", source: "route", layout: line, paint: { "line-color": token("--surface", "#ffffff"), "line-width": 8, "line-opacity": 0.9 } });
        m.addLayer({ id: "map3d-route", type: "line", source: "route", layout: line, paint: { "line-color": token("--info-fg", "#000000"), "line-width": 4 } });

        // Unnamed waypoints are a route planner's clicks, not places: skip them.
        for (const w of route.waypoints) {
          if (!w.name?.trim()) continue;
          new maplibre.Marker({ element: markEl("hike-waypoint", "point", w.name) }).setLngLat(lngLat(w.at)).addTo(m);
        }
        const loop = Math.abs(route.start[0] - route.finish[0]) < 6e-4 && Math.abs(route.start[1] - route.finish[1]) < 9e-4;
        if (!loop) new maplibre.Marker({ element: markEl("hike-track-end", "end", "Finish") }).setLngLat(lngLat(route.finish)).addTo(m);
        new maplibre.Marker({ element: markEl("hike-track-start", "end", loop ? "Start and finish" : "Start") }).setLngLat(lngLat(route.start)).addTo(m);
        dotRef.current = new maplibre.Marker({ element: markEl("map3d-along", "along") });

        // Tilt into the hills from the flat fit, so it's plain this map is 3D.
        m.easeTo({ ...OVERVIEW, zoom: m.getZoom() - 0.3, duration: prefersReducedMotion() ? 0 : 1600 });
        setReady(true);
      });
    }, () => {
      if (!cancelled) setFailed("load");
    });

    return () => {
      cancelled = true;
      // Unmounting mid-flight still tells the profile the flight is over.
      stopRef.current?.();
      dotRef.current?.remove();
      dotRef.current = null;
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [route]);

  // The profile being scrubbed: a dot on the line, and the camera left alone.
  useEffect(() => {
    const map = mapRef.current;
    const dot = dotRef.current;
    if (!map || !dot || !ready) return;
    const at = along == null ? null : pointAlong(route.segments, along);
    if (at) dot.setLngLat(lngLat(at)).addTo(map);
    else dot.remove();
  }, [along, ready, route]);

  function stop() {
    stopRef.current?.();
  }

  function fly() {
    const map = mapRef.current;
    if (!map || flying) return;
    const total = routeLengthKm(route.segments);
    const first = pointAlong(route.segments, 0);
    if (!total || !first) return;
    const home = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;

    const end = (finished: boolean) => {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      for (const type of GRABS) map.off(type, interrupt);
      stopRef.current = null;
      setFlying(false);
      onAlongRef.current?.(null);
      // Back to the overview at the end; a member who grabbed the map keeps their view.
      if (finished && mapRef.current) mapRef.current.easeTo({ ...home, duration: reduced ? 0 : 1200 });
    };
    // Grabbing the map takes the camera back. Only a member's own gesture carries
    // an originalEvent; the flight's own camera moves don't.
    const interrupt = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) end(false);
    };
    for (const type of GRABS) map.on(type, interrupt);
    stopRef.current = () => end(false);
    setFlying(true);

    // Look this far ahead to point the camera, so it follows the walk rather than every wiggle.
    const lookAhead = Math.min(Math.max(total * 0.04, 0.25), 1.2);
    const heading = (km: number) => {
      const here = pointAlong(route.segments, km)!;
      const ahead = pointAlong(route.segments, Math.min(km + lookAhead, total))!;
      return km + 0.01 >= total ? map.getBearing() : bearingBetween(here, ahead);
    };

    if (reduced) {
      // No sweeping camera: a handful of still views along the way, held long enough to look at.
      const stops = 6;
      let i = 0;
      const step = () => {
        const km = (total * i) / (stops - 1);
        map.jumpTo({ center: lngLat(pointAlong(route.segments, km)!), bearing: heading(km), ...FLY });
        onAlongRef.current?.(km);
        i += 1;
        timer = setTimeout(() => (i < stops ? step() : end(true)), 2500);
      };
      step();
      return;
    }

    // Roughly a minute for a long day out, never under half one for a short walk.
    const duration = Math.min(Math.max(total * 3000, 30_000), 60_000);
    let started: number | null = null;
    let last = 0;
    let bearing = heading(0);
    const tick = (now: number) => {
      started ??= now;
      const t = Math.min((now - started) / duration, 1);
      // Ease in and out so the start and finish aren't a lurch.
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const km = total * eased;
      const dt = last ? now - last : 16;
      last = now;
      // A time-based blend, so the turn rate is the same at 60 Hz as at 120.
      bearing = turnToward(bearing, heading(km), 1 - Math.exp(-dt / 900));
      map.jumpTo({ center: lngLat(pointAlong(route.segments, km)!), bearing, ...FLY });
      onAlongRef.current?.(km);
      if (t < 1) frame = requestAnimationFrame(tick);
      else end(true);
    };
    // Settle onto the start first, then set off.
    map.easeTo({ center: lngLat(first), bearing, ...FLY, duration: 1200 });
    map.once("moveend", () => {
      if (alive) frame = requestAnimationFrame(tick);
    });
  }

  return (
    <div className="map3d-wrap">
      {/* Kept mounted when it fails, so the map behind it is still cleaned up. */}
      <div ref={container} className="map3d" role="region" aria-label={label} data-no-swipe="" hidden={Boolean(failed)} />
      {failed ? (
        <p className="map3d-failed" role="status">
          {failed === "webgl"
            ? "3D needs WebGL, which this device doesn't have — the flat map is still above."
            : "The 3D map couldn't load just now — the flat map is still above."}
        </p>
      ) : null}
      <div className="map3d-controls" hidden={Boolean(failed)}>
        {flying ? (
          <button type="button" className="kit-btn" onClick={stop}>
            <Pause size={14} aria-hidden="true" /> Stop
          </button>
        ) : (
          <button type="button" className="kit-btn" onClick={fly} disabled={!ready}>
            <Play size={14} aria-hidden="true" /> Fly along
          </button>
        )}
      </div>
    </div>
  );
}
