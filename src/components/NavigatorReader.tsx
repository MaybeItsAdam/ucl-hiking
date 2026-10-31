"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type AnimationEvent as ReactAnimationEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, ExternalLink, LoaderCircle, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { NavigatorDownload } from "@/components/NavigatorDownload";
import { OpenExternal } from "@/components/OpenExternal";
import { formatBytes, readerViews, viewIndexOf } from "@/lib/navigator";

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
// A tap this far in from either side of the page area turns the page.
const EDGE_ZONE = 0.3;
// Drawn pages kept: the view on screen and the ones either side of it, twice over.
const PAGES_KEPT = 12;

type Drawn = { canvas: HTMLCanvasElement | null; task: RenderTask | null; promise: Promise<HTMLCanvasElement> };

/**
 * Every page the reader draws, drawn once and kept for a while, so that turning
 * to a page that was drawn ahead of time puts it on screen in the same frame. A
 * page is drawn off screen and copied into whichever canvas shows it, which is
 * also how the turning leaf can show the page you are leaving.
 */
class PageStore {
  private drawn = new Map<string, Drawn>();

  constructor(private doc: PDFDocumentProxy) {}

  static key(page: number, width: number): string {
    return `${page}@${width}`;
  }

  /** The finished drawing, if there is one: used to paint before the browser does. */
  peek(page: number, width: number): HTMLCanvasElement | null {
    const key = PageStore.key(page, width);
    const entry = this.drawn.get(key);
    if (!entry?.canvas) return null;
    this.touch(key, entry);
    return entry.canvas;
  }

  get(page: number, width: number): Promise<HTMLCanvasElement> {
    const key = PageStore.key(page, width);
    let entry = this.drawn.get(key);
    if (entry) this.touch(key, entry);
    else {
      entry = this.draw(key, page, width);
      this.drawn.set(key, entry);
      this.trim();
    }
    return entry.promise;
  }

  /** Stops drawing anything not wanted any more: a size the window has since left, a page skipped past. */
  retain(wanted: Set<string>) {
    for (const [key, entry] of this.drawn) if (!entry.canvas && !wanted.has(key)) this.drop(key, entry);
  }

  destroy() {
    for (const [key, entry] of this.drawn) this.drop(key, entry);
  }

  private draw(key: string, pageNumber: number, width: number): Drawn {
    const entry: Drawn = { canvas: null, task: null, promise: Promise.resolve(null as unknown as HTMLCanvasElement) };
    entry.promise = (async () => {
      const page = await this.doc.getPage(pageNumber);
      if (this.drawn.get(key) !== entry) throw new Error("dropped");
      const base = page.getViewport({ scale: 1 });
      let scale = (width / base.width) * Math.min(window.devicePixelRatio || 1, 3);
      const area = base.width * scale * base.height * scale;
      if (area > MAX_PAGE_PIXELS) scale *= Math.sqrt(MAX_PAGE_PIXELS / area);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      entry.task = page.render({ canvas, viewport });
      await entry.task.promise;
      entry.task = null;
      entry.canvas = canvas;
      return canvas;
    })();
    entry.promise.catch(() => {
      if (this.drawn.get(key) === entry) this.drawn.delete(key);
    });
    return entry;
  }

  private touch(key: string, entry: Drawn) {
    this.drawn.delete(key);
    this.drawn.set(key, entry);
  }

  private trim() {
    for (const [key, entry] of this.drawn) {
      if (this.drawn.size <= PAGES_KEPT) break;
      this.drop(key, entry);
    }
  }

  private drop(key: string, entry: Drawn) {
    this.drawn.delete(key);
    entry.task?.cancel();
    // A zero-sized canvas hands its memory back at once; iOS counts it until then.
    if (entry.canvas) entry.canvas.width = entry.canvas.height = 0;
  }
}

/** One page, at the size it is shown, sharp on high-DPI screens. */
function PdfPage({
  store,
  pageNumber,
  width,
  height,
  placeholder,
}: {
  store: PageStore;
  pageNumber: number;
  width: number;
  height: number;
  placeholder?: string | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  // A layout effect, so a page drawn ahead of time is painted before the browser
  // shows the frame: a turn never flashes an empty page. A new size keeps the old
  // drawing, stretched, until the sharp one is ready.
  useLayoutEffect(() => {
    let live = true;
    const paint = (source: HTMLCanvasElement) => {
      const target = canvas.current;
      if (!live || !target || !source.width) return;
      target.width = source.width;
      target.height = source.height;
      target.getContext("2d")?.drawImage(source, 0, 0);
      target.parentElement?.classList.add("is-drawn");
    };
    const ready = store.peek(pageNumber, width);
    if (ready) paint(ready);
    else
      store.get(pageNumber, width).then(paint, () => {
        // Dropped for a newer size, or a page that won't draw: the placeholder stays.
      });
    return () => {
      live = false;
    };
  }, [store, pageNumber, width]);

  return (
    <span
      className="navigator-pdf-page"
      style={{ width, height, backgroundImage: placeholder ? `url(${placeholder})` : undefined }}
    >
      <canvas ref={canvas} style={{ width, height }} aria-hidden="true" />
    </span>
  );
}

function pageFromHash(): number {
  const match = /(?:^#|&)page=(\d+)/.exec(window.location.hash);
  return match ? Math.max(1, Number(match[1])) : 1;
}

// Facing pages sit as they do in print: even numbers on the left, odd on the right.
const leftOf = (view: readonly number[]) => view.find((p) => p % 2 === 0) ?? null;
const rightOf = (view: readonly number[]) => view.find((p) => p % 2 === 1) ?? null;

type Turn = { dir: "next" | "prev"; from: number[]; to: number[]; spreads: boolean; n: number };

/**
 * The Navigator, open. Facing pages on a wide screen and one page at a time on a
 * phone. A tap on either edge, a swipe, the arrow keys or the buttons turn the
 * page: facing pages flip over the spine, a single page lifts away like a
 * notebook's. The scrubber along the bottom jumps anywhere. Pages either side of
 * the one open are drawn ahead, and the PDF itself arrives in ranges, so opening
 * an issue doesn't mean downloading it.
 */
export function NavigatorReader({
  issue,
  src,
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
  const [zoomIndex, setZoomIndex] = useState(0);
  const [turn, setTurn] = useState<Turn | null>(null);
  // The scrubber's position while a finger is on it; the page follows on release.
  const [scrub, setScrub] = useState<number | null>(null);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const gesture = useRef<{ x: number; y: number; id: number; type: string } | null>(null);

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

  const store = useMemo(() => (doc ? new PageStore(doc) : null), [doc]);
  useEffect(() => () => store?.destroy(), [store]);

  // Where to start, and a page that doesn't scroll behind the reader.
  useEffect(() => {
    const start = pageFromHash();
    queueMicrotask(() => setPage(start));
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
      // Zoomed in, the page changes in place: a flip of a page bigger than the screen is all blur.
      if (zoom > 1) {
        setTurn(null);
        return;
      }
      setTurn((t) => ({
        dir: dir ?? (target > viewIndex ? "next" : "prev"),
        from: views[viewIndex],
        to: views[target],
        spreads,
        n: (t?.n ?? 0) + 1,
      }));
    },
    [views, viewIndex, zoom, spreads],
  );
  const next = useCallback(() => goToView(viewIndex + 1, "next"), [goToView, viewIndex]);
  const prev = useCallback(() => goToView(viewIndex - 1, "prev"), [goToView, viewIndex]);
  const zoomBy = useCallback((step: number) => setZoomIndex((z) => Math.max(0, Math.min(ZOOMS.length - 1, z + step))), []);

  // A turn that never reports its end (a tab in the background) still finishes.
  useEffect(() => {
    if (!turn) return;
    const timer = window.setTimeout(() => setTurn((t) => (t === turn ? null : t)), 1200);
    return () => window.clearTimeout(timer);
  }, [turn]);
  const activeTurn = turn && turn.spreads === spreads && zoom === 1 ? turn : null;

  // Draw ahead: the pages on screen first, then the next view, then the previous.
  useEffect(() => {
    if (!store || !pageWidth) return;
    const wanted = [view];
    if (zoom === 1) wanted.push(views[viewIndex + 1] ?? [], views[viewIndex - 1] ?? []);
    const pages = wanted.flat();
    store.retain(new Set(pages.map((p) => PageStore.key(p, pageWidth))));
    for (const p of pages) store.get(p, pageWidth).catch(() => {});
  }, [store, view, views, viewIndex, pageWidth, zoom]);

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

  /** Where on the stage a tap landed: the left edge, the right edge or the middle. */
  function zoneOf(clientX: number): "prev" | "next" | null {
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    return x < EDGE_ZONE ? "prev" : x > 1 - EDGE_ZONE ? "next" : null;
  }

  // A swipe or a tap on either edge turns the page. Only at fit-to-screen:
  // zoomed in, a drag pans and a tap does nothing.
  function onPointerDown(event: ReactPointerEvent) {
    if (zoom > 1 || !event.isPrimary) return;
    gesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId, type: event.pointerType };
  }
  function onPointerUp(event: ReactPointerEvent) {
    const start = gesture.current;
    gesture.current = null;
    if (!start || start.id !== event.pointerId || !doc) return;
    if ((event.target as Element).closest("button, a, input")) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const zone = zoneOf(event.clientX);
      if (zone === "next") next();
      else if (zone === "prev") prev();
      return;
    }
    // A mouse drag selects or does nothing; fingers and pens swipe.
    if (start.type === "mouse" || Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (dx < 0) next();
    else prev();
  }

  function commitScrub() {
    if (scrub === null) return;
    setScrub(null);
    goToView(scrub);
  }

  function endTurn(event: ReactAnimationEvent) {
    if (event.target === event.currentTarget) setTurn(null);
  }

  const shownIndex = scrub ?? viewIndex;
  const shownView = views[shownIndex] ?? view;
  const pageLabel = shownView.length > 1 ? `${shownView[0]}–${shownView[shownView.length - 1]}` : String(shownView[0]);

  /** What lies flat during a turn: the side the leaf hasn't reached yet still shows the page being left. */
  function book() {
    if (!store) return null;
    const pageProps = (p: number) => ({
      store,
      pageNumber: p,
      width: pageWidth,
      height: pageHeight,
      placeholder: p === 1 ? cover : null,
    });
    if (!spreads) {
      // One page: turning on, the old page lifts off the new one; turning back,
      // the earlier page settles down over the current one.
      const flat = activeTurn?.dir === "prev" ? activeTurn.from[0] : view[0];
      const leaf = activeTurn ? (activeTurn.dir === "next" ? activeTurn.from[0] : activeTurn.to[0]) : null;
      return (
        <div className="navigator-book" style={{ width: pageWidth, height: pageHeight, perspective: pageWidth * 3 }}>
          <div className="navigator-slot">
            <PdfPage key={flat} {...pageProps(flat)} />
          </div>
          {activeTurn && leaf ? (
            <div
              key={activeTurn.n}
              className={`navigator-leaf leaf-single-${activeTurn.dir}`}
              style={{ width: pageWidth, height: pageHeight }}
              onAnimationEnd={endTurn}
            >
              <div className="navigator-leaf-face">
                <PdfPage key={leaf} {...pageProps(leaf)} />
                <span className="navigator-leaf-shade" />
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    // Facing pages: the leaf is the right-hand page going forward, or the left
    // going back, hinged at the spine, with the page it lands as on its back.
    const t = activeTurn;
    const left = t ? leftOf(t.dir === "next" ? t.from : t.to) : leftOf(view);
    const right = t ? rightOf(t.dir === "next" ? t.to : t.from) : rightOf(view);
    const front = t ? (t.dir === "next" ? rightOf(t.from) : leftOf(t.from)) : null;
    const back = t ? (t.dir === "next" ? leftOf(t.to) : rightOf(t.to)) : null;
    const side = (p: number | null, which: "left" | "right") =>
      p ? <PdfPage key={p} {...pageProps(p)} /> : <span className={`navigator-blank-page is-${which}`} style={{ width: pageWidth, height: pageHeight }} />;
    return (
      <div className="navigator-book is-spread" style={{ width: pageWidth * 2, height: pageHeight, perspective: pageWidth * 4 }}>
        <div className="navigator-slot is-left">{left ? side(left, "left") : null}</div>
        <div className="navigator-slot is-right" style={{ left: pageWidth }}>
          {right ? side(right, "right") : null}
        </div>
        {t ? (
          <div
            key={t.n}
            className={`navigator-leaf leaf-spread-${t.dir}`}
            style={{ left: t.dir === "next" ? pageWidth : 0, width: pageWidth, height: pageHeight }}
            onAnimationEnd={endTurn}
          >
            <div className={`navigator-leaf-face ${t.dir === "next" ? "is-right" : "is-left"}`}>
              {side(front, t.dir === "next" ? "right" : "left")}
              <span className="navigator-leaf-shade" />
            </div>
            <div className={`navigator-leaf-face navigator-leaf-back ${t.dir === "next" ? "is-left" : "is-right"}`}>
              {side(back, t.dir === "next" ? "left" : "right")}
              <span className="navigator-leaf-shade" />
            </div>
          </div>
        ) : null}
      </div>
    );
  }

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
        className={`navigator-stage${zoom > 1 ? " is-zoomed" : ""}`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (gesture.current = null)}
        onDoubleClick={(event) => {
          // Double-tapping the middle zooms; the edges are for turning.
          if (zoom > 1 || !zoneOf(event.clientX)) setZoomIndex((z) => (z === 0 ? 2 : 0));
        }}
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
          <div className="navigator-view" style={{ padding: pad }}>
            {book()}
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

      <footer className="navigator-controls">
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
