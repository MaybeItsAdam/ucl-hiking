"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  GalleryHorizontalEnd,
  LoaderCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { OpenExternal } from "@/components/OpenExternal";
import { readerViews, viewIndexOf } from "@/lib/navigator";

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

const ZOOMS = [1, 1.5, 2, 3];
// iOS refuses to draw a canvas over ~16.7M pixels and runs out of canvas memory
// soon after, so a page at 3x on a retina iPad is drawn a little softer instead.
const MAX_PAGE_PIXELS = 12_000_000;
const SWIPE_DISTANCE = 48;
const THUMB_WIDTH = 64;

/** Draws one PDF page into a canvas at the size it is shown, sharp on high-DPI screens. */
function PdfPage({
  doc,
  pageNumber,
  width,
  height,
  maxPixels = MAX_PAGE_PIXELS,
  placeholder,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  height: number;
  maxPixels?: number;
  placeholder?: string | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState<string | null>(null);
  const key = `${pageNumber}@${width}`;

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      let scale = (width / base.width) * Math.min(window.devicePixelRatio || 1, 3);
      const area = base.width * scale * base.height * scale;
      if (area > maxPixels) scale *= Math.sqrt(maxPixels / area);
      const viewport = page.getViewport({ scale });
      // Drawn off screen and copied over once finished, so a re-render (zoom,
      // rotation) replaces the old drawing in one go instead of blanking it.
      const scratch = document.createElement("canvas");
      scratch.width = Math.floor(viewport.width);
      scratch.height = Math.floor(viewport.height);
      task = page.render({ canvas: scratch, viewport });
      await task.promise;
      const target = canvas.current;
      if (cancelled || !target) return;
      target.width = scratch.width;
      target.height = scratch.height;
      target.getContext("2d")?.drawImage(scratch, 0, 0);
      scratch.width = scratch.height = 0;
      setDrawn(key);
    })().catch(() => {
      // Cancelled by a newer render, or a page that won't draw: the placeholder stays.
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, width, maxPixels, key]);

  return (
    <span
      className={`navigator-pdf-page${drawn ? " is-drawn" : ""}`}
      style={{ width, height, backgroundImage: placeholder && !drawn ? `url(${placeholder})` : undefined }}
    >
      <canvas ref={canvas} style={{ width, height }} aria-hidden="true" />
    </span>
  );
}

/** A thumbnail that only draws once it scrolls near the strip's visible part. */
function Thumb({
  doc,
  pageNumber,
  aspect,
  current,
  onSelect,
  root,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  aspect: number;
  current: boolean;
  onSelect: (page: number) => void;
  root: HTMLElement | null;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = button.current;
    if (!el || seen || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { root, rootMargin: "0px 240px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [root, seen]);

  const height = Math.round(THUMB_WIDTH / aspect);
  return (
    <button
      ref={button}
      type="button"
      className={`navigator-thumb${current ? " is-current" : ""}`}
      aria-label={`Page ${pageNumber}`}
      aria-current={current ? "page" : undefined}
      onClick={() => onSelect(pageNumber)}
    >
      {seen ? (
        <PdfPage doc={doc} pageNumber={pageNumber} width={THUMB_WIDTH} height={height} maxPixels={200_000} />
      ) : (
        <span className="navigator-pdf-page" style={{ width: THUMB_WIDTH, height }} />
      )}
      <span className="navigator-thumb-number">{pageNumber}</span>
    </button>
  );
}

function pageFromHash(): number {
  const match = /(?:^#|&)page=(\d+)/.exec(window.location.hash);
  return match ? Math.max(1, Number(match[1])) : 1;
}

/**
 * The Navigator, open. Facing pages on a wide screen and one page at a time on a
 * phone; swipe, arrow keys or the buttons turn the page; a strip of thumbnails
 * jumps anywhere. Pages are drawn by pdf.js as they come into view, and the PDF
 * itself arrives in ranges, so opening an issue doesn't mean downloading it.
 */
export function NavigatorReader({
  src,
  sourceUrl,
  label,
  title,
  cover,
  knownPages,
}: {
  src: string;
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
  const [zoomIndex, setZoomIndex] = useState(0);
  const [turn, setTurn] = useState<{ dir: "next" | "prev"; n: number } | null>(null);
  const [showThumbs, setShowThumbs] = useState(true);
  const [native, setNative] = useState(false);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);

  // Open the document.
  useEffect(() => {
    let task: PDFDocumentLoadingTask | null = null;
    let cancelled = false;
    loadPdfJs()
      .then(async (pdfjs) => {
        if (cancelled) return;
        task = pdfjs.getDocument({
          url: src,
          // Ranges of 2MB: big enough that a photo spread is one or two requests,
          // small enough that the first page is on screen quickly.
          rangeChunkSize: 2 * 1024 * 1024,
          disableAutoFetch: true,
          disableStream: true,
        });
        const opened = await task.promise;
        const first = await opened.getPage(1);
        const view = first.getViewport({ scale: 1 });
        if (cancelled) return;
        setPageSize({ w: view.width, h: view.height });
        setPage((p) => Math.min(p, opened.numPages));
        setDoc(opened);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [src]);

  // Where to start, the platform, and a page that doesn't scroll behind the reader.
  useEffect(() => {
    const start = pageFromHash();
    const native = Capacitor.isNativePlatform();
    const narrow = window.matchMedia("(max-width: 640px)").matches;
    queueMicrotask(() => {
      setPage(start);
      setNative(native);
      if (narrow) setShowThumbs(false);
    });
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, []);

  // The stage's size decides spreads versus single pages, and the page size.
  useEffect(() => {
    if (!stage) return;
    const measure = () => setStageSize({ w: stage.clientWidth, h: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage]);

  const pageCount = doc?.numPages ?? knownPages ?? 1;
  const spreads = stageSize.w >= 720 && stageSize.w > stageSize.h * 1.05;
  const views = useMemo(() => readerViews(pageCount, spreads), [pageCount, spreads]);
  const viewIndex = viewIndexOf(views, page);
  const view = useMemo(() => views[viewIndex] ?? [1], [views, viewIndex]);
  const firstShown = view[0];
  const zoom = ZOOMS[zoomIndex];

  const pad = stageSize.w < 640 ? 12 : 24;
  const columns = spreads ? 2 : 1;
  const fit = Math.max(
    0.05,
    Math.min((stageSize.w - pad * 2) / (columns * pageSize.w), (stageSize.h - pad * 2) / pageSize.h),
  );
  const pageWidth = Math.floor(pageSize.w * fit * zoom);
  const pageHeight = Math.floor(pageSize.h * fit * zoom);

  const goToView = useCallback(
    (index: number, dir?: "next" | "prev") => {
      const target = Math.max(0, Math.min(views.length - 1, index));
      if (target === viewIndex) return;
      setPage(views[target][0]);
      setTurn((t) => ({ dir: dir ?? (target > viewIndex ? "next" : "prev"), n: (t?.n ?? 0) + 1 }));
    },
    [views, viewIndex],
  );
  const next = useCallback(() => goToView(viewIndex + 1, "next"), [goToView, viewIndex]);
  const prev = useCallback(() => goToView(viewIndex - 1, "prev"), [goToView, viewIndex]);
  const goToPage = useCallback((p: number) => goToView(viewIndexOf(views, p)), [goToView, views]);
  const zoomBy = useCallback((step: number) => setZoomIndex((z) => Math.max(0, Math.min(ZOOMS.length - 1, z + step))), []);

  // Keep the place in the URL, so a reload or a shared link opens the same page.
  useEffect(() => {
    if (!doc) return;
    window.history.replaceState(window.history.state, "", `#page=${firstShown}`);
  }, [doc, firstShown]);

  // Keyboard: arrows and page keys turn, Home/End jump, +/- zoom, Escape leaves.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const actions: Record<string, () => void> = {
        ArrowRight: next,
        ArrowLeft: prev,
        PageDown: next,
        PageUp: prev,
        " ": next,
        Home: () => goToView(0),
        End: () => goToView(views.length - 1),
        "+": () => zoomBy(1),
        "=": () => zoomBy(1),
        "-": () => zoomBy(-1),
        "0": () => setZoomIndex(0),
        Escape: () => router.push("/portal/navigator"),
      };
      const action = actions[event.key];
      // Zoomed in, the arrow keys scroll the page as usual.
      if (!action || (zoom > 1 && event.key.startsWith("Arrow"))) return;
      if (event.key === " " && target?.closest("button, a")) return;
      event.preventDefault();
      action();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, goToView, views.length, zoomBy, zoom, router]);

  // Zooming keeps the middle of the view in the middle; a new page starts at its top.
  useLayoutEffect(() => {
    stage?.scrollTo({
      left: (stage.scrollWidth - stage.clientWidth) / 2,
      top: (stage.scrollHeight - stage.clientHeight) / 2,
    });
  }, [stage, zoom]);
  useLayoutEffect(() => {
    stage?.scrollTo({ top: 0 });
  }, [stage, viewIndex]);

  // The current page stays in sight in the thumbnail strip.
  useEffect(() => {
    if (!strip || !showThumbs) return;
    const current = strip.querySelector<HTMLElement>(".navigator-thumb.is-current");
    if (!current) return;
    const left = current.offsetLeft - (strip.clientWidth - current.offsetWidth) / 2;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    strip.scrollTo({ left, behavior: reduce ? "auto" : "smooth" });
  }, [strip, showThumbs, viewIndex, doc]);

  // Swipe to turn. Only at fit-to-screen: zoomed in, a drag pans the page.
  function onPointerDown(event: ReactPointerEvent) {
    if (zoom > 1 || event.pointerType === "mouse") return;
    swipe.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }
  function onPointerUp(event: ReactPointerEvent) {
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (dx < 0) next();
    else prev();
  }

  const pageLabel = view.length > 1 ? `${view[0]}–${view[view.length - 1]}` : String(view[0]);
  const aspect = pageSize.w / pageSize.h;

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
          {native ? null : (
            <a className="navigator-icon-btn" href={`${src}?download`} download aria-label="Download PDF" title="Download PDF">
              <Download size={18} aria-hidden="true" />
            </a>
          )}
          <OpenExternal href={sourceUrl} className="navigator-icon-btn">
            <ExternalLink size={18} aria-hidden="true" />
            <span className="sr-only">Open the original</span>
          </OpenExternal>
        </div>
      </header>

      <div
        ref={setStage}
        className={`navigator-stage${zoom > 1 ? " is-zoomed" : ""}`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
        onDoubleClick={() => setZoomIndex((z) => (z === 0 ? 2 : 0))}
      >
        {failed ? (
          <div className="navigator-message">
            <p>The magazine wouldn&rsquo;t open here.</p>
            <OpenExternal href={sourceUrl} className="navigator-text-btn">
              <ExternalLink size={16} aria-hidden="true" /> Open the original
            </OpenExternal>
          </div>
        ) : !doc || !stageSize.w ? (
          <div className="navigator-message" aria-live="polite">
            {cover && stageSize.w ? (
              <span className="navigator-pdf-page navigator-cover-wait" style={{ width: pageWidth, height: pageHeight, backgroundImage: `url(${cover})` }} />
            ) : null}
            <span className="navigator-loading">
              <LoaderCircle size={16} aria-hidden="true" /> Opening the magazine
            </span>
          </div>
        ) : (
          <div
            key={turn ? `${viewIndex}-${turn.n}` : viewIndex}
            className={`navigator-view${turn ? ` turn-${turn.dir}` : ""}${view.length > 1 ? " is-spread" : ""}`}
            style={{ padding: pad }}
          >
            {view.map((p) => (
              <PdfPage key={p} doc={doc} pageNumber={p} width={pageWidth} height={pageHeight} placeholder={p === 1 ? cover : null} />
            ))}
          </div>
        )}
        {doc && zoom === 1 ? (
          <>
            <button type="button" className="navigator-side navigator-side-prev" onClick={prev} disabled={viewIndex === 0} aria-label="Previous page">
              <ChevronLeft size={22} aria-hidden="true" />
            </button>
            <button type="button" className="navigator-side navigator-side-next" onClick={next} disabled={viewIndex >= views.length - 1} aria-label="Next page">
              <ChevronRight size={22} aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>

      {doc && showThumbs ? (
        <div ref={setStrip} className="navigator-strip" role="group" aria-label="Pages">
          {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((p) => (
            <Thumb key={p} doc={doc} pageNumber={p} aspect={aspect} current={view.includes(p)} onSelect={goToPage} root={strip} />
          ))}
        </div>
      ) : null}

      <footer className="navigator-controls">
        <button
          type="button"
          className={`navigator-icon-btn${showThumbs ? " is-on" : ""}`}
          onClick={() => setShowThumbs((s) => !s)}
          aria-pressed={showThumbs}
          aria-label="Page thumbnails"
          title="Page thumbnails"
          disabled={!doc}
        >
          <GalleryHorizontalEnd size={18} aria-hidden="true" />
        </button>
        <div className="navigator-pager">
          <button type="button" className="navigator-icon-btn" onClick={prev} disabled={!doc || viewIndex === 0} aria-label="Previous page">
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <span className="navigator-count" aria-live="polite">
            <span className="navigator-card-label">Page</span> {pageLabel} <span className="navigator-of">of {pageCount}</span>
          </span>
          <button type="button" className="navigator-icon-btn" onClick={next} disabled={!doc || viewIndex >= views.length - 1} aria-label="Next page">
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="navigator-zoom">
          <button type="button" className="navigator-icon-btn" onClick={() => zoomBy(-1)} disabled={!doc || zoomIndex === 0} aria-label="Zoom out">
            <ZoomOut size={18} aria-hidden="true" />
          </button>
          <button type="button" className="navigator-zoom-level" onClick={() => setZoomIndex(0)} disabled={!doc} aria-label="Fit to screen">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className="navigator-icon-btn" onClick={() => zoomBy(1)} disabled={!doc || zoomIndex === ZOOMS.length - 1} aria-label="Zoom in">
            <ZoomIn size={18} aria-hidden="true" />
          </button>
        </div>
      </footer>
    </div>
  );
}
