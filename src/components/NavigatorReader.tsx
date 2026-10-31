"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, ExternalLink, LoaderCircle, X, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { NavigatorDownload } from "@/components/NavigatorDownload";
import { OpenExternal } from "@/components/OpenExternal";
import { FlipBook } from "@/lib/flipbook";
import { formatBytes, readerViews, viewIndexOf } from "@/lib/navigator";
import { RenderQueue, bucketWidth, preloadPlan } from "@/lib/navigatorCache";
import { openIssueFile } from "@/lib/navigatorFile";
import { NAVIGATOR_CHUNK_BYTES } from "@/lib/navigatorRange";
import { getPageImage, markOpened, putPageImage } from "@/lib/navigatorStore";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

// pdf.js and its worker are loaded on first use, in the browser only. The legacy
// build is the one that still runs in the older WebKit an iPhone on an older iOS
// ships to the app's WebView. The worker is written as new Worker(new URL(…,
// import.meta.url)) so webpack bundles it as its own file on this origin, which
// is also the origin the native app is served from.
let pdfjsLoad: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsLoad ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerPort) {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(
        new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url),
        { type: "module" },
      );
    }
    return pdfjs;
  });
  pdfjsLoad.catch(() => {
    pdfjsLoad = null;
  });
  return pdfjsLoad;
}

// iOS refuses to draw a canvas over ~16.7M pixels and runs out of canvas memory
// soon after, so a big page is drawn a little softer instead.
const MAX_PAGE_PIXELS = 12_000_000;
// Zoom levels in the zoomed view, as multiples of the page at fit-to-screen.
const ZOOMS = [2, 3, 4];
// A tap this far in from either side of the page area turns the page.
const EDGE_ZONE = 0.3;
// Rendered page images held as object URLs either side of the page open.
const IMAGES_KEPT_AROUND = 8;
const DOUBLE_TAP_MS = 300;
// A sideways flick at least this long, and no slower than this, turns the page.
const SWIPE_DISTANCE = 40;
const SWIPE_MS = 700;

function pageFromHash(): number {
  const match = /(?:^#|&)page=(\d+)/.exec(window.location.hash);
  return match ? Math.max(1, Number(match[1])) : 1;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Draws one page at `pxWidth` device pixels wide and encodes it as a JPEG. The
 * canvas is never in the document and is emptied straight after, so only the
 * compressed image stays in memory.
 */
async function renderPageImage(doc: PDFDocumentProxy, pageNumber: number, pxWidth: number, signal: AbortSignal): Promise<Blob> {
  const page = await doc.getPage(pageNumber);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const base = page.getViewport({ scale: 1 });
  let scale = pxWidth / base.width;
  const area = base.width * scale * base.height * scale;
  if (area > MAX_PAGE_PIXELS) scale *= Math.sqrt(MAX_PAGE_PIXELS / area);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  try {
    const task = page.render({ canvas, viewport });
    const cancel = () => task.cancel();
    signal.addEventListener("abort", cancel);
    try {
      await task.promise;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob) throw new Error("Couldn't encode the page");
    return blob;
  } finally {
    // A zero-sized canvas hands its memory back at once; iOS counts it until then.
    canvas.width = canvas.height = 0;
    page.cleanup();
  }
}

/** A page image: kept on the device if it was drawn before, drawn and kept if not. */
async function pageImage(doc: PDFDocumentProxy, version: string | null, pageNumber: number, pxWidth: number, signal: AbortSignal): Promise<Blob> {
  if (version) {
    const kept = await getPageImage(version, pageNumber, pxWidth);
    if (kept) return kept;
  }
  const blob = await renderPageImage(doc, pageNumber, pxWidth, signal);
  if (version) void putPageImage(version, pageNumber, pxWidth, blob);
  return blob;
}

type Zoom = { page: number; level: number; fx: number; fy: number };

/**
 * The Navigator, open, laid out like the printed magazine: the cover alone, then
 * facing pages across the gutter on a wide screen, one page at a time on a phone.
 * Drag a page and it turns under the finger (FlipBook, src/lib/flipbook.ts); a
 * flick, a tap on either edge, the arrow keys and the buttons turn it too.
 * A pinch or a double-tap opens the page zoomed, outside the book, to pan around.
 *
 * Pages are drawn by pdf.js a few ahead and behind, encoded as images and kept on
 * the device, as are the PDF's bytes, so reopening an issue is instant and
 * doesn't go back to Drive.
 */
export function NavigatorReader({
  issue,
  src,
  version,
  directUrl,
  bytes,
  sourceUrl,
  label,
  title,
  cover,
  knownPages,
}: {
  issue: number;
  src: string;
  /** navigatorVersion(issue): what everything kept on the device is keyed by. */
  version: string;
  directUrl: string;
  bytes: number | null;
  sourceUrl: string;
  label: string;
  title: string;
  cover: string | null;
  knownPages: number | null;
}) {
  const router = useRouter();
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [pageSize, setPageSize] = useState<{ w: number; h: number }>({ w: 640, h: 828 });
  const [page, setPage] = useState(1);
  const [scrub, setScrub] = useState<number | null>(null);
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const bookRef = useRef<HTMLDivElement | null>(null);
  const flipRef = useRef<FlipBook | null>(null);
  // One image element per drawn page. The book moves them between its faces, so
  // a page decoded once never flashes as it turns.
  const imgs = useRef(new Map<number, HTMLImageElement>());
  const urls = useRef(new Map<number, string>());
  const dir = useRef<1 | -1>(1);
  const pageRef = useRef(1);
  // The page a turn in progress is heading for, so "is it drawn?" asks about the right one.
  const target = useRef(1);
  // The last tap, for double-taps.
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null);

  // Open the document: through the device's copy of the file when the size is known.
  useEffect(() => {
    let task: PDFDocumentLoadingTask | null = null;
    const abort = new AbortController();
    (async () => {
      const pdfjs = await loadPdfJs();
      const file = bytes ? await openIssueFile(src, version, bytes, abort.signal).catch(() => null) : null;
      if (abort.signal.aborted) return;
      if (file) {
        void markOpened(version, issue);
        const transport = new pdfjs.PDFDataRangeTransport(bytes!, file.first.slice());
        transport.requestDataRange = (begin: number, end: number) => {
          file.cache.read(begin, end).then(
            (data) => transport.onDataRange(begin, data),
            () => {
              if (!abort.signal.aborted) setFailed(true);
            },
          );
        };
        task = pdfjs.getDocument({ range: transport, rangeChunkSize: NAVIGATOR_CHUNK_BYTES, disableAutoFetch: true, disableStream: true });
        abort.signal.addEventListener("abort", () => file.cache.abort());
      } else {
        task = pdfjs.getDocument({ url: src, rangeChunkSize: NAVIGATOR_CHUNK_BYTES, disableAutoFetch: true, disableStream: true });
      }
      const opened = await task.promise;
      const first = await opened.getPage(1);
      const view = first.getViewport({ scale: 1 });
      if (abort.signal.aborted) return;
      setPageSize({ w: view.width, h: view.height });
      setPage((p) => Math.min(p, opened.numPages));
      setDoc(opened);
    })().catch(() => {
      if (!abort.signal.aborted) setFailed(true);
    });
    return () => {
      abort.abort();
      void task?.destroy();
    };
  }, [src, version, bytes, issue]);

  // Where to start, and a page that neither scrolls nor bounces behind the reader.
  useEffect(() => {
    const start = pageFromHash();
    queueMicrotask(() => setPage(start));
    const root = document.documentElement;
    const previous = { overflow: root.style.overflow, overscroll: root.style.overscrollBehavior };
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    return () => {
      root.style.overflow = previous.overflow;
      root.style.overscrollBehavior = previous.overscroll;
    };
  }, []);

  useEffect(() => {
    if (!stage) return;
    const measure = () => setStageSize({ w: stage.clientWidth, h: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage]);

  const pageCount = doc?.numPages ?? knownPages ?? 1;
  // Always facing pages, the way the magazine is printed: the cover alone, then
  // spreads. On a phone held upright that's two small pages; a pinch or a
  // double-tap opens either one full size.
  const spreads = pageCount > 1;
  const views = useMemo(() => readerViews(pageCount, spreads), [pageCount, spreads]);
  const viewIndex = viewIndexOf(views, page);
  const view = useMemo(() => views[viewIndex] ?? [1], [views, viewIndex]);
  const firstShown = view[0];

  const pad = stageSize.w < 640 ? 4 : 24;
  const columns = spreads ? 2 : 1;
  const fit = Math.max(0.05, Math.min((stageSize.w - pad * 2) / (columns * pageSize.w), (stageSize.h - pad * 2) / pageSize.h));
  const pageWidth = Math.floor(pageSize.w * fit);
  const pageHeight = Math.floor(pageSize.h * fit);
  // Drawing a page holds the main thread for as long as it takes, and that time
  // grows with its pixels: a phone's 3x screen gets pages at 2x, which still
  // reads sharp at book size. The zoomed view draws its own, sharper copy.
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const dpr = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, coarse ? 2 : 3);
  const pxWidth = bucketWidth(pageWidth * dpr);

  useEffect(() => {
    pageRef.current = page;
    target.current = page;
  }, [page]);

  // The queue that draws pages ahead, one per document and pixel width: a new
  // size starts it over. Images far from the page open are let go of; the
  // device keeps them.
  const queue = useRef<{ key: string; queue: RenderQueue<Blob> } | null>(null);
  const resumeTimer = useRef<number | undefined>(undefined);
  const dropQueue = useCallback(() => {
    queue.current?.queue.stop();
    queue.current = null;
    for (const url of urls.current.values()) URL.revokeObjectURL(url);
    urls.current.clear();
    imgs.current.clear();
  }, []);
  useEffect(() => dropQueue, [dropQueue, doc]);

  // Draw ahead: what's on screen, then the next pages, then the ones behind.
  useEffect(() => {
    if (!doc || pageWidth < 40) return;
    const key = String(pxWidth);
    if (queue.current?.key !== key) {
      dropQueue();
      const fileVersion = bytes ? version : null;
      queue.current = {
        key,
        queue: new RenderQueue<Blob>(
          (p, signal) => pageImage(doc, fileVersion, p, pxWidth, signal),
          (p, blob) => {
            const old = urls.current.get(p);
            if (old) URL.revokeObjectURL(old);
            const url = URL.createObjectURL(blob);
            urls.current.set(p, url);
            let img = imgs.current.get(p);
            if (!img) {
              img = document.createElement("img");
              img.alt = `Page ${p}`;
              img.draggable = false;
              img.decoding = "async";
              imgs.current.set(p, img);
            }
            showImage(img, url, () => flipRef.current?.refresh());
          },
        ),
      };
    }
    const q = queue.current.queue;
    const plan = preloadPlan(views, viewIndex, dir.current);
    q.plan(plan);
    let evicted = false;
    for (const [p, url] of urls.current) {
      if (plan.includes(p) || Math.abs(p - firstShown) <= IMAGES_KEPT_AROUND) continue;
      URL.revokeObjectURL(url);
      urls.current.delete(p);
      q.forget(p);
      imgs.current.get(p)?.remove();
      imgs.current.delete(p);
      evicted = true;
    }
    if (evicted) flipRef.current?.refresh();
  }, [doc, pageWidth, pxWidth, bytes, version, views, viewIndex, firstShown, dropQueue]);

  // The book. Rebuilt when the page size or spreads-versus-single changes (a
  // rotation, a resize); the drawn images carry over. Nothing runs between turns.
  useEffect(() => {
    const host = bookRef.current;
    if (!doc || !host || pageWidth < 40) return;
    const book = new FlipBook({
      host,
      views,
      spreads,
      pageWidth,
      pageHeight,
      start: viewIndexOf(views, Math.min(pageRef.current, pageCount)),
      duration: prefersReducedMotion() ? 0 : 620,
      pageImage: (p) => {
        const img = imgs.current.get(p);
        return img?.classList.contains("is-drawn") ? img : null;
      },
      placeholder: (p) => (p === 1 ? cover : null),
      // No page is drawn while one is moving; drawing starts again a moment
      // after it lands, so a quick run of turns isn't held up either.
      onTurnStart: () => {
        window.clearTimeout(resumeTimer.current);
        queue.current?.queue.pause();
      },
      onIdle: () => {
        window.clearTimeout(resumeTimer.current);
        resumeTimer.current = window.setTimeout(() => queue.current?.queue.resume(), 220);
      },
      onSettle: (i) => {
        const p = views[i]?.[0] ?? 1;
        dir.current = p >= pageRef.current ? 1 : -1;
        target.current = p;
        setPage(p);
      },
    });
    flipRef.current = book;
    return () => {
      window.clearTimeout(resumeTimer.current);
      queue.current?.queue.resume();
      book.destroy();
      if (flipRef.current === book) flipRef.current = null;
    };
    // pageRef carries the page in; a turn doesn't rebuild the book.
  }, [doc, pageWidth, pageHeight, spreads, pageCount, cover, views]);

  const turn = useCallback(
    (step: 1 | -1) => {
      const flip = flipRef.current;
      if (!flip) return;
      dir.current = step;
      // A turn already under way lands first, so quick taps each turn a page.
      if (!flip.flip(step)) return;
      target.current = views[flip.turning ? flip.current + step : flip.current]?.[0] ?? target.current;
    },
    [views],
  );
  const next = useCallback(() => turn(1), [turn]);
  const prev = useCallback(() => turn(-1), [turn]);
  const goToView = useCallback(
    (index: number) => {
      const t = views[Math.max(0, Math.min(views.length - 1, index))];
      if (!t) return;
      dir.current = t[0] >= pageRef.current ? 1 : -1;
      target.current = t[0];
      flipRef.current?.jump(views.indexOf(t));
      setPage(t[0]);
    },
    [views],
  );

  // Keep the place in the URL, so a reload or a shared link opens the same page.
  useEffect(() => {
    if (!doc) return;
    window.history.replaceState(window.history.state, "", `#page=${firstShown}`);
  }, [doc, firstShown]);

  const previewOf = useCallback((p: number) => urls.current.get(p) ?? null, []);

  const openZoom = useCallback(
    (p: number, fx = 0.5, fy = 0.5) => {
      if (!doc) return;
      lastTap.current = null;
      setZoom({ page: p, level: 0, fx, fy });
    },
    [doc],
  );

  // Keyboard: arrows and page keys turn, Home/End jump, + and - zoom, Escape leaves.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const t = event.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      const zoomIn = () => (zoom ? setZoom({ ...zoom, level: Math.min(ZOOMS.length - 1, zoom.level + 1) }) : openZoom(firstShown));
      const zoomOut = () => setZoom(zoom && zoom.level > 0 ? { ...zoom, level: zoom.level - 1 } : null);
      const actions: Record<string, () => void> = zoom
        ? { Escape: () => setZoom(null), "+": zoomIn, "=": zoomIn, "-": zoomOut, "0": () => setZoom(null) }
        : {
            ArrowRight: next,
            ArrowLeft: prev,
            PageDown: next,
            PageUp: prev,
            " ": next,
            Home: () => goToView(0),
            End: () => goToView(views.length - 1),
            "+": zoomIn,
            "=": zoomIn,
            Escape: () => router.push("/portal/navigator"),
          };
      const action = actions[event.key];
      if (!action) return;
      if (event.key === " " && t?.closest("button, a")) return;
      event.preventDefault();
      action();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, goToView, views.length, zoom, openZoom, firstShown, router]);

  /** Opens the zoomed view on whichever page is under a point on the screen. */
  function zoomAt(clientX: number, clientY: number) {
    const rects = view.map((p) => [p, flipRef.current?.pageRect(p) ?? undefined] as const);
    const hit = rects.find(([, r]) => r && r.width && clientX >= r.left && clientX <= r.right) ?? rects[0];
    const r = hit?.[1];
    const fx = r && r.width ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0.5;
    const fy = r && r.height ? Math.min(1, Math.max(0, (clientY - r.top) / r.height)) : 0.5;
    openZoom(hit?.[0] ?? firstShown, fx, fy);
  }

  // Every pointer on the book is handled here, finger, pen or mouse alike; the
  // book itself only draws. The way a page turns is fixed by the first sideways
  // movement, so an ordinary thumb flick always turns the way it was flicked.
  //  - A drag sideways pulls the page over from the spine, following the finger;
  //    let go past 30% of the way, or flick, and it turns, otherwise it settles back.
  //  - A tap on either edge turns; a double-tap in the middle zooms.
  //  - Two fingers pinch: spreading them opens the zoomed page.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    id: number;
    x0: number;
    y0: number;
    t0: number;
    /** A page being pulled over: which way, and how far the finger goes for a whole turn. */
    fold: { dir: 1 | -1; reach: number } | null;
    dead: boolean;
  } | null>(null);
  const pinch = useRef<{ d0: number; d: number; x: number; y: number } | null>(null);

  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  /** Lets go of a page being pulled: on over, or back where it was. */
  function release(turnIt: boolean) {
    const g = gesture.current;
    const flip = flipRef.current;
    if (!g?.fold || !flip) return;
    if (turnIt) target.current = views[flip.current + g.fold.dir]?.[0] ?? target.current;
    flip.release(turnIt);
  }

  function onPointerDown(event: ReactPointerEvent) {
    if (zoom || !doc || (event.target as Element).closest("button, a, input")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (pointers.current.size === 2) {
      // A second finger: a pinch. Any curl under way settles back.
      if (gesture.current?.fold) release(false);
      gesture.current = null;
      const s0 = spread();
      pinch.current = { d0: s0.d, d: s0.d, x: s0.x, y: s0.y };
      return;
    }
    if (pointers.current.size > 2) return;
    gesture.current = { id: event.pointerId, x0: event.clientX, y0: event.clientY, t0: event.timeStamp, fold: null, dead: false };
  }

  function onPointerMove(event: ReactPointerEvent) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      pinch.current.d = spread().d;
      return;
    }
    const g = gesture.current;
    const flip = flipRef.current;
    if (!g || g.id !== event.pointerId || g.dead || !flip) return;
    const dx = event.clientX - g.x0;
    const dy = event.clientY - g.y0;
    if (!g.fold) {
      if (Math.hypot(dx, dy) < 10) return;
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      // Vertical, or nothing that way: not a page turn.
      if (Math.abs(dx) < Math.abs(dy) || !flip.beginDrag(dir)) {
        g.dead = true;
        return;
      }
      g.fold = { dir, reach: spreads ? pageWidth * 1.6 : pageWidth };
    }
    flip.dragTo((-dx * g.fold.dir) / g.fold.reach);
  }

  function onPointerUp(event: ReactPointerEvent) {
    const wasPinch = pinch.current;
    pointers.current.delete(event.pointerId);
    if (wasPinch) {
      if (pointers.current.size === 0) {
        pinch.current = null;
        if (wasPinch.d / wasPinch.d0 > 1.15) zoomAt(wasPinch.x, wasPinch.y);
      }
      return;
    }
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.id !== event.pointerId || !doc || !stage) return;
    const dx = event.clientX - g.x0;
    const dt = event.timeStamp - g.t0;
    if (g.fold) {
      const flick = Math.abs(dx) >= SWIPE_DISTANCE && dt <= SWIPE_MS && Math.sign(dx) === -g.fold.dir;
      const far = (-dx * g.fold.dir) / g.fold.reach > 0.3;
      if (flick || far) dir.current = g.fold.dir;
      gesture.current = g;
      release(flick || far);
      gesture.current = null;
      return;
    }
    if (g.dead || Math.hypot(dx, event.clientY - g.y0) > 10 || dt > 350) return;
    const rect = stage.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    if (fx < EDGE_ZONE) return prev();
    if (fx > 1 - EDGE_ZONE) return next();
    const last = lastTap.current;
    if (last && event.timeStamp - last.t < DOUBLE_TAP_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 40) {
      lastTap.current = null;
      zoomAt(event.clientX, event.clientY);
    } else {
      lastTap.current = { x: event.clientX, y: event.clientY, t: event.timeStamp };
    }
  }

  function onPointerCancel(event: ReactPointerEvent) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) pinch.current = null;
    if (gesture.current?.id === event.pointerId) {
      release(false);
      gesture.current = null;
    }
  }

  function commitScrub() {
    if (scrub === null) return;
    setScrub(null);
    goToView(scrub);
  }

  // For the touch tests: is the page shown (or being turned to) drawn yet?
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __navigatorShown?: () => boolean };
    w.__navigatorShown = () => {
      const t = target.current;
      const pages = views[viewIndexOf(views, t)] ?? [t];
      return pages.every((p) => imgs.current.get(p)?.classList.contains("is-drawn"));
    };
    return () => {
      delete w.__navigatorShown;
    };
  }, [views]);

  const shownIndex = scrub ?? viewIndex;
  const shownView = views[shownIndex] ?? view;
  const pageLabel = shownView.length > 1 ? `${shownView[0]}–${shownView[shownView.length - 1]}` : String(shownView[0]);
  const ready = !!doc && stageSize.w > 0;

  return (
    <div className="navigator-reader" data-no-swipe role="region" aria-label={`The Navigator, ${label}: ${title}`}>
      <header className="navigator-reader-bar">
        <Link href="/portal/navigator" className="navigator-icon-btn navigator-back" aria-label="Back to the library">
          <ChevronLeft size={20} aria-hidden="true" />
          <span className="navigator-back-text">Library</span>
        </Link>
        <div className="navigator-reader-title">
          <span className="navigator-card-label">The Navigator · {label}</span>
          <strong>{title}</strong>
        </div>
        <div className="navigator-reader-actions">
          <NavigatorDownload
            issue={issue}
            directUrl={directUrl}
            bytes={bytes}
            className="navigator-icon-btn"
            title={bytes ? `Download PDF · ${formatBytes(bytes)}` : "Download PDF"}
          >
            <Download size={18} aria-hidden="true" />
            <span className="sr-only">Download PDF{bytes ? `, ${formatBytes(bytes)}` : ""}</span>
          </NavigatorDownload>
          <OpenExternal href={sourceUrl} className="navigator-icon-btn">
            <ExternalLink size={18} aria-hidden="true" />
            <span className="sr-only">Open the original</span>
          </OpenExternal>
        </div>
      </header>

      <div
        ref={setStage}
        className="navigator-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {failed ? (
          <div className="navigator-message">
            <p>The magazine wouldn&rsquo;t open here.</p>
            <OpenExternal href={sourceUrl} className="navigator-text-btn">
              <ExternalLink size={16} aria-hidden="true" /> Open the original
            </OpenExternal>
          </div>
        ) : !ready ? (
          <div className="navigator-message" aria-live="polite">
            {cover && stageSize.w ? (
              <span className="navigator-cover-wait" style={{ width: pageWidth, height: pageHeight, backgroundImage: `url(${cover})` }} />
            ) : null}
            <span className="navigator-loading">
              <LoaderCircle size={16} aria-hidden="true" /> Opening the magazine
            </span>
          </div>
        ) : null}
        {/* The book is always in the document once open, so page-flip keeps its DOM. */}
        <div className="navigator-view" hidden={!ready || failed}>
          <div key={`${pageWidth}x${pageHeight}-${spreads}`} ref={bookRef} className="navigator-book" style={{ width: pageWidth * columns, height: pageHeight }} />
        </div>
        {ready ? (
          <>
            <button type="button" className="navigator-side navigator-side-prev" onClick={prev} disabled={viewIndex === 0} aria-label="Previous page">
              <ChevronLeft size={22} aria-hidden="true" />
            </button>
            <button type="button" className="navigator-side navigator-side-next" onClick={next} disabled={viewIndex >= views.length - 1} aria-label="Next page">
              <ChevronRight size={22} aria-hidden="true" />
            </button>
          </>
        ) : null}
        {zoom && doc ? (
          <ZoomView
            doc={doc}
            version={bytes ? version : null}
            zoom={zoom}
            fitWidth={pageWidth}
            fitHeight={pageHeight}
            dpr={dpr}
            previewOf={previewOf}
            onChange={setZoom}
          />
        ) : null}
      </div>

      <div className="navigator-scrub">
        <input
          type="range"
          min={0}
          max={Math.max(0, views.length - 1)}
          step={1}
          value={shownIndex}
          disabled={!doc || views.length < 2}
          aria-label="Page"
          aria-valuetext={`Page ${pageLabel} of ${pageCount}`}
          onChange={(event) => setScrub(Number(event.target.value))}
          onPointerUp={commitScrub}
          onKeyUp={commitScrub}
          onBlur={commitScrub}
        />
      </div>

      {/* A div, not a <footer>: the site footer's styles would land on it. */}
      <div className="navigator-controls">
        <div className="navigator-pager">
          <button type="button" className="navigator-icon-btn" onClick={prev} disabled={!doc || viewIndex === 0} aria-label="Previous page">
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <span className="navigator-count" aria-live="polite">
            {pageLabel} <span className="navigator-of">/ {pageCount}</span>
          </span>
          <button type="button" className="navigator-icon-btn" onClick={next} disabled={!doc || viewIndex >= views.length - 1} aria-label="Next page">
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="navigator-zoom">
          {zoom ? (
            <>
              <button type="button" className="navigator-icon-btn" onClick={() => setZoom(zoom.level > 0 ? { ...zoom, level: zoom.level - 1 } : null)} aria-label="Zoom out">
                <ZoomOut size={18} aria-hidden="true" />
              </button>
              <span className="navigator-zoom-level">{ZOOMS[zoom.level] * 100}%</span>
              <button type="button" className="navigator-icon-btn" onClick={() => setZoom({ ...zoom, level: Math.min(ZOOMS.length - 1, zoom.level + 1) })} disabled={zoom.level === ZOOMS.length - 1} aria-label="Zoom in">
                <ZoomIn size={18} aria-hidden="true" />
              </button>
            </>
          ) : (
            <button type="button" className="navigator-icon-btn" onClick={() => openZoom(firstShown)} disabled={!doc} aria-label="Zoom in">
              <ZoomIn size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Points a page's image at a new drawing, and marks it drawn once decoded, so it never paints half-loaded. */
function showImage(img: HTMLImageElement, url: string, done: () => void) {
  img.src = url;
  img.decode().then(
    () => {
      if (img.src !== url) return;
      img.classList.add("is-drawn");
      done();
    },
    () => {},
  );
}

/**
 * One page, zoomed, over the book: drawn sharp at the zoom level, panned by
 * dragging (the browser's own scrolling). A pinch steps the zoom; a double-tap
 * or pinching back past the first level closes it.
 */
function ZoomView({
  doc,
  version,
  zoom,
  fitWidth,
  fitHeight,
  dpr,
  previewOf,
  onChange,
}: {
  doc: PDFDocumentProxy;
  version: string | null;
  zoom: Zoom;
  fitWidth: number;
  fitHeight: number;
  dpr: number;
  /** The page as drawn for the book, shown stretched until the sharp one is ready. */
  previewOf: (page: number) => string | null;
  onChange: (zoom: Zoom | null) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastUp = useRef<{ x: number; y: number; t: number } | null>(null);
  const [sharp, setSharp] = useState<{ key: string; url: string } | null>(null);
  const scale = ZOOMS[zoom.level];
  const width = Math.round(fitWidth * scale);
  const height = Math.round(fitHeight * scale);
  const key = `${zoom.page}@${width}`;

  useEffect(() => {
    const abort = new AbortController();
    let url: string | null = null;
    pageImage(doc, version, zoom.page, bucketWidth(width * dpr), abort.signal).then(
      (blob) => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setSharp({ key, url });
      },
      () => {},
    );
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc, version, zoom.page, width, dpr, key]);

  // Keep the point that was pinched or tapped under the finger.
  const { fx, fy } = zoom;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: fx * el.scrollWidth - el.clientWidth / 2, top: fy * el.scrollHeight - el.clientHeight / 2 });
  }, [width, fx, fy]);

  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let pinch: { d0: number; d: number } | null = null;
    const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const focus = () => {
      const z = zoomRef.current;
      return { fx: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth, fy: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight, z };
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const d = distance(e.touches);
      pinch = { d0: d, d };
    };
    const onMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length < 2) return;
      e.preventDefault();
      pinch.d = distance(e.touches);
    };
    const onEnd = (e: TouchEvent) => {
      if (!pinch || e.touches.length > 0) return;
      const ratio = pinch.d / pinch.d0;
      pinch = null;
      const { fx: x, fy: y, z } = focus();
      if (ratio > 1.2) onChange({ ...z, level: Math.min(ZOOMS.length - 1, z.level + 1), fx: x, fy: y });
      else if (ratio < 0.8) onChange(z.level > 0 ? { ...z, level: z.level - 1, fx: x, fy: y } : null);
    };
    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
    };
  }, [onChange]);

  const src = sharp?.key === key ? sharp.url : previewOf(zoom.page);
  return (
    <div
      className="navigator-zoomview"
      role="dialog"
      aria-label={`Page ${zoom.page}, zoomed`}
      // Taps here are the zoomed view's, not the book's (a double-tap to close mustn't reopen it).
      onPointerDown={(event) => {
        event.stopPropagation();
        down.current = { x: event.clientX, y: event.clientY, t: event.timeStamp };
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        // A double-tap or double-click closes. Counted from pointers that went
        // down here, so the tap that opened the view never counts towards it
        // (nor does the dblclick a browser makes of that double-tap).
        const d = down.current;
        down.current = null;
        if (!d || event.timeStamp - d.t > 350 || Math.hypot(event.clientX - d.x, event.clientY - d.y) > 10) return;
        const last = lastUp.current;
        if (last && event.timeStamp - last.t < DOUBLE_TAP_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 40) {
          lastUp.current = null;
          onChange(null);
        } else lastUp.current = { x: event.clientX, y: event.clientY, t: event.timeStamp };
      }}
    >
      <div ref={scroller} className="navigator-zoomview-scroll">
        <div className="navigator-zoomview-page" style={{ width, height }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL drawn on the device */}
          {src ? <img src={src} alt={`Page ${zoom.page}`} draggable={false} /> : null}
        </div>
      </div>
      <button type="button" className="navigator-icon-btn navigator-zoomview-close" onClick={() => onChange(null)} aria-label="Close zoom">
        <X size={20} aria-hidden="true" />
      </button>
    </div>
  );
}
