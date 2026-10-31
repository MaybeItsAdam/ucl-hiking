/**
 * The Navigator reader's bookkeeping, kept free of the browser so it can be
 * tested: which pages to draw ahead and in what order, the queue that draws
 * them, and what to throw away when the device's copy grows past its limits.
 * src/lib/navigatorStore.ts does the storing; the reader does the drawing.
 */

/** Rendered pages kept on the device, all issues together. */
export const PAGE_CACHE_BYTES = 150 * 1024 * 1024;
/** PDF bytes kept for issues that aren't saved to the device, all together. */
export const CHUNK_CACHE_BYTES = 200 * 1024 * 1024;
/** Pages drawn ahead in the direction of reading, and behind it. */
export const PRELOAD_AHEAD = 4;
export const PRELOAD_BEHIND = 2;

/**
 * Rendered widths go up in steps, so a page drawn for one window size is still
 * used after the toolbar or the window moves a few pixels.
 */
export const WIDTH_STEP = 128;
export function bucketWidth(px: number): number {
  return Math.max(WIDTH_STEP, Math.ceil(px / WIDTH_STEP) * WIDTH_STEP);
}

/** One rendered page on the device: the issue's file, the page, its pixel width. */
export function pageKey(version: string, page: number, width: number): string {
  return `${version}|${page}|${width}`;
}

/**
 * The order to draw pages in, starting with what's on screen. Then the next
 * view, then the one behind (a reader often turns back once), then further on,
 * then further back. `dir` is the way the reader last turned.
 */
export function preloadPlan(
  views: readonly (readonly number[])[],
  index: number,
  dir: 1 | -1 = 1,
  ahead = PRELOAD_AHEAD,
  behind = PRELOAD_BEHIND,
): number[] {
  const out: number[] = [];
  const add = (i: number) => {
    for (const p of views[i] ?? []) if (!out.includes(p)) out.push(p);
  };
  // Pages, not views: in spreads a view is two pages.
  const pagesFrom = (start: number, step: number, limit: number) => {
    const list: number[] = [];
    for (let i = start; i >= 0 && i < views.length && list.length < limit; i += step) list.push(...views[i]);
    return list.slice(0, limit);
  };
  add(index);
  const forward = pagesFrom(index + dir, dir, ahead);
  const backward = pagesFrom(index - dir, -dir, behind);
  if (forward.length) out.push(...views[index + dir].filter((p) => !out.includes(p)));
  if (backward.length) out.push(...views[index - dir].filter((p) => !out.includes(p)));
  for (const p of forward) if (!out.includes(p)) out.push(p);
  for (const p of backward) if (!out.includes(p)) out.push(p);
  return out;
}

export type CacheEntry = { key: string; bytes: number; at: number };

/** Least recently used first, until what's left fits under `cap`. */
export function lruEvictions(entries: readonly CacheEntry[], cap: number): string[] {
  let total = entries.reduce((sum, e) => sum + e.bytes, 0);
  if (total <= cap) return [];
  const out: string[] = [];
  for (const e of [...entries].sort((a, b) => a.at - b.at)) {
    if (total <= cap) break;
    out.push(e.key);
    total -= e.bytes;
  }
  return out;
}

export type IssueOnDevice = { version: string; bytes: number; lastOpened: number; saved: boolean };

/**
 * Whole issues to let go of, longest unopened first, until the PDF bytes kept
 * for unsaved issues fit under `cap`. A saved issue and the one open now stay.
 */
export function issuesToEvict(issues: readonly IssueOnDevice[], cap: number, keep: string | null = null): string[] {
  const loose = issues.filter((i) => !i.saved);
  let total = loose.reduce((sum, i) => sum + i.bytes, 0);
  const out: string[] = [];
  for (const i of [...loose].sort((a, b) => a.lastOpened - b.lastOpened)) {
    if (total <= cap) break;
    if (i.version === keep) continue;
    out.push(i.version);
    total -= i.bytes;
  }
  return out;
}

/**
 * Draws pages one at a time, in the order of the latest plan. A new plan (the
 * reader turned or jumped) cancels the drawing in progress if that page isn't
 * wanted any more, and starts on the most wanted page instead. Pages already
 * drawn aren't drawn again until forgotten.
 */
export class RenderQueue<T> {
  private wanted: number[] = [];
  private done = new Set<number>();
  private running: { page: number; controller: AbortController } | null = null;
  private stopped = false;
  private paused = false;

  constructor(
    private readonly work: (page: number, signal: AbortSignal) => Promise<T>,
    private readonly onDone: (page: number, value: T) => void,
    private readonly onError: (page: number, error: unknown) => void = () => {},
  ) {}

  plan(pages: readonly number[]) {
    this.wanted = [...pages];
    if (this.running && !this.wanted.includes(this.running.page)) this.running.controller.abort();
    this.pump();
  }

  /** Lets a page be drawn again (its image was let go of). */
  forget(page: number) {
    this.done.delete(page);
  }

  isDone(page: number) {
    return this.done.has(page);
  }

  get current(): number | null {
    return this.running?.page ?? null;
  }

  /**
   * Starts nothing new until resume(): drawing a page holds the main thread,
   * which a page turn needs every frame of. A page already being drawn finishes.
   */
  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.pump();
  }

  stop() {
    this.stopped = true;
    this.running?.controller.abort();
  }

  private pump() {
    if (this.stopped || this.paused || this.running) return;
    const page = this.wanted.find((p) => !this.done.has(p));
    if (page === undefined) return;
    const controller = new AbortController();
    const job = { page, controller };
    this.running = job;
    this.work(page, controller.signal).then(
      (value) => {
        if (this.running === job) this.running = null;
        if (controller.signal.aborted || this.stopped) return this.pump();
        this.done.add(page);
        this.onDone(page, value);
        this.pump();
      },
      (error) => {
        if (this.running === job) this.running = null;
        if (!controller.signal.aborted && !this.stopped) {
          // Not wanted until the next plan: a page that won't draw shouldn't spin.
          this.wanted = this.wanted.filter((p) => p !== page);
          this.onError(page, error);
        }
        this.pump();
      },
    );
  }
}
