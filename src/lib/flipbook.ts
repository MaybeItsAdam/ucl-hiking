/**
 * A magazine page turn, drawn only with transforms and opacity.
 *
 * Replaces StPageFlip, which ran a requestAnimationFrame loop forever (destroy()
 * never stopped it, so every rebuild on a resize or rotation left another one
 * going), rewrote the inline style of every page in the issue on each frame, and
 * animated clip-path polygons, which repaint the whole page image every frame.
 * Here a page that turns is one element hinged at the spine and rotated in 3D,
 * its shading is gradients whose opacity changes, and nothing runs between turns.
 * All of that stays on the compositor, so a turn holds its frame rate on a phone.
 *
 * Layout follows a printed magazine. The cover sits alone, centred, and the book
 * slides open around it as the first page turns. Inside, pages face each other
 * across a shaded gutter. The edges of the pages already read and still to come
 * show as a thin stack either side. On a phone it is one page at a time, hinged
 * on its left edge.
 */

export type FlipBookOptions = {
  host: HTMLElement;
  /** The reader's views: [1], [2, 3], [4, 5], … in spreads, [1], [2], … in single pages. */
  views: readonly (readonly number[])[];
  spreads: boolean;
  pageWidth: number;
  pageHeight: number;
  /** The view to open on. */
  start: number;
  /** A full turn, in ms. 0 jumps without animating (reduced motion). */
  duration: number;
  /** The image element for a page, if it's been drawn. The engine moves it between faces. */
  pageImage: (page: number) => HTMLImageElement | null;
  /** Something to show on a page until its image is drawn (the cover, say). */
  placeholder?: (page: number) => string | null;
  /** A turn has finished on this view. */
  onSettle: (viewIndex: number) => void;
  /** A page has started moving. */
  onTurnStart?: () => void;
  /** Nothing is moving any more (after every turn, including one let go back). */
  onIdle?: () => void;
};

type Sides = { l: number | null; r: number | null };
type Turn = {
  /** The turn is between views k and k + 1. Progress 0 is view k, 1 is view k + 1. */
  k: number;
  p: number;
  raf: number | null;
  /** Where an animation under way is heading (0 or 1); null while a finger holds it. */
  to: number | null;
};

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function el(className: string, parent?: HTMLElement): HTMLDivElement {
  const div = document.createElement("div");
  div.className = className;
  parent?.appendChild(div);
  return div;
}

export class FlipBook {
  private o: FlipBookOptions;
  private root: HTMLDivElement;
  private shift: HTMLDivElement;
  private edgeL: HTMLDivElement;
  private edgeR: HTMLDivElement;
  private left: { page: HTMLDivElement; face: HTMLDivElement; shade: HTMLDivElement };
  private right: { page: HTMLDivElement; face: HTMLDivElement; shade: HTMLDivElement };
  private leaf: HTMLDivElement;
  private front: { face: HTMLDivElement; shade: HTMLDivElement; side: HTMLDivElement };
  private back: { face: HTMLDivElement; shade: HTMLDivElement; side: HTMLDivElement };
  private index: number;
  private turn: Turn | null = null;
  private destroyed = false;
  // A drag's latest position, drawn once per frame however often the finger reports.
  private pending: number | null = null;
  private pendingRaf: number | null = null;

  constructor(options: FlipBookOptions) {
    this.o = options;
    const { host, spreads, pageWidth: w, pageHeight: h } = options;
    this.index = Math.max(0, Math.min(options.views.length - 1, options.start));

    this.root = el(`fb ${spreads ? "fb-spreads" : "fb-single"}`);
    this.root.style.width = `${spreads ? w * 2 : w}px`;
    this.root.style.height = `${h}px`;
    this.shift = el("fb-shift", this.root);
    this.shift.style.perspective = `${Math.round(w * 8)}px`;
    this.edgeL = el("fb-edge fb-edge-l", this.shift);
    this.edgeR = el("fb-edge fb-edge-r", this.shift);

    const page = (side: "l" | "r") => {
      const p = el(`fb-page fb-page-${side}`, this.shift);
      p.style.width = `${w}px`;
      p.style.left = side === "l" ? "0" : spreads ? `${w}px` : "0";
      const face = el("fb-face", p);
      el("fb-gutter", p);
      const shade = el("fb-shade", p);
      return { page: p, face, shade };
    };
    this.left = page("l");
    this.right = page("r");

    this.leaf = el("fb-leaf", this.shift);
    this.leaf.style.width = `${w}px`;
    this.leaf.style.left = spreads ? `${w}px` : "0";
    const side = (cls: string) => {
      const s = el(`fb-side ${cls}`, this.leaf);
      const face = el("fb-face", s);
      el("fb-gutter", s);
      const shade = el("fb-shade", s);
      return { side: s, face, shade };
    };
    this.front = side("fb-front");
    this.back = side("fb-back");

    host.replaceChildren(this.root);
    this.settle(this.index, false);
  }

  /** The view on screen, or the one a turn under way started from. */
  get current(): number {
    return this.index;
  }

  get turning(): boolean {
    return this.turn !== null;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.pendingRaf != null) cancelAnimationFrame(this.pendingRaf);
    if (this.turn?.raf != null) cancelAnimationFrame(this.turn.raf);
    this.turn = null;
    this.root.remove();
  }

  /** Turns a page, animated. A turn already under way finishes at once first. */
  flip(dir: 1 | -1): boolean {
    this.finish();
    if (!this.o.views[this.index + dir]) return false;
    if (this.o.duration <= 0) {
      this.settle(this.index + dir);
      return true;
    }
    this.begin(dir);
    this.animateTo(dir > 0 ? 1 : 0, this.o.duration, easeInOut);
    return true;
  }

  /** Goes straight to a view, no animation. */
  jump(viewIndex: number): void {
    this.cancel();
    const i = Math.max(0, Math.min(this.o.views.length - 1, viewIndex));
    this.settle(i, i !== this.index);
  }

  /** A finger starts pulling a page over. False if there's nothing that way. */
  beginDrag(dir: 1 | -1): boolean {
    this.finish();
    if (!this.o.views[this.index + dir]) return false;
    this.begin(dir);
    return true;
  }

  /** How far over the page is pulled, 0 to 1, in the direction the drag began. */
  dragTo(amount: number): void {
    const t = this.turn;
    if (!t || t.raf != null) return;
    const dir = t.k === this.index ? 1 : -1;
    this.pending = dir > 0 ? clamp01(amount) : 1 - clamp01(amount);
    this.pendingRaf ??= requestAnimationFrame(() => {
      this.pendingRaf = null;
      const p = this.pending;
      this.pending = null;
      if (p !== null && this.turn === t && t.raf == null) this.draw(p);
    });
  }

  /** Lets go: on over (commit) or back where it was. */
  release(commit: boolean): void {
    const t = this.turn;
    if (!t || t.raf != null) return;
    if (this.pending !== null) {
      this.draw(this.pending);
      this.pending = null;
    }
    const dir = t.k === this.index ? 1 : -1;
    const to = commit === dir > 0 ? 1 : 0;
    const remaining = Math.abs(to - t.p);
    if (this.o.duration <= 0 || remaining < 0.001) {
      this.settle(to === 1 ? t.k + 1 : t.k, to === 1 ? t.k + 1 !== this.index : t.k !== this.index);
      return;
    }
    this.animateTo(to, Math.max(120, this.o.duration * 0.75 * remaining), easeOut);
  }

  /** Re-places page images, after one has been drawn. */
  refresh(): void {
    if (this.turn) this.layoutTurn(this.turn.k);
    else this.layoutStatic(this.index);
  }

  /** Where a page is on screen, if it's showing. */
  pageRect(page: number): DOMRect | null {
    for (const face of [this.left.face, this.right.face, this.front.face, this.back.face]) {
      if (face.dataset.page === String(page) && face.isConnected) {
        const r = (face.parentElement as HTMLElement).getBoundingClientRect();
        if (r.width) return r;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------

  private sides(i: number): Sides {
    const v = this.o.views[i] ?? [];
    if (!this.o.spreads) return { l: null, r: v[0] ?? null };
    if (v.length >= 2) return { l: v[0], r: v[1] };
    if (v.length === 1) return i === 0 ? { l: null, r: v[0] } : { l: v[0], r: null };
    return { l: null, r: null };
  }

  /** How far the book slides so a lone page (the cover, the back) sits in the middle. */
  private offset(i: number): number {
    if (!this.o.spreads) return 0;
    const s = this.sides(i);
    const half = this.o.pageWidth / 2;
    if (s.l === null && s.r !== null) return -half;
    if (s.r === null && s.l !== null) return half;
    return 0;
  }

  private fill(face: HTMLDivElement, page: number | null): void {
    const key = page === null ? "" : String(page);
    const img = page === null ? null : this.o.pageImage(page);
    if (face.dataset.page !== key || face.firstChild !== img) {
      face.dataset.page = key;
      if (img) face.replaceChildren(img);
      else face.replaceChildren();
    }
    const ph = page === null ? null : this.o.placeholder?.(page) ?? null;
    face.style.backgroundImage = ph ? `url(${ph})` : "";
    (face.parentElement as HTMLElement).classList.toggle("is-blank", page === null);
  }

  private layoutStatic(i: number): void {
    const s = this.sides(i);
    // Clear the leaf first so a page it held can move to a static face.
    this.fill(this.front.face, null);
    this.fill(this.back.face, null);
    this.fill(this.left.face, s.l);
    this.fill(this.right.face, s.r);
    this.left.page.hidden = !this.o.spreads || s.l === null;
    this.right.page.hidden = s.r === null;
  }

  private layoutTurn(k: number): void {
    const a = this.sides(k);
    const b = this.sides(k + 1);
    for (const f of [this.left.face, this.right.face, this.front.face, this.back.face]) this.fill(f, null);
    this.fill(this.left.face, a.l);
    this.fill(this.right.face, b.r);
    this.fill(this.front.face, a.r);
    this.fill(this.back.face, this.o.spreads ? b.l : null);
    this.left.page.hidden = !this.o.spreads || a.l === null;
    this.right.page.hidden = b.r === null;
  }

  private edges(i: number): void {
    const views = this.o.views;
    const total = Math.max(1, views.length - 1);
    // A hairline per few pages, never more than a few pixels: thickness, not decoration.
    const read = Math.round((i / total) * 6);
    const left = Math.round(((views.length - 1 - i) / total) * 6);
    const s = this.sides(i);
    this.edgeL.style.width = `${this.o.spreads && s.l !== null ? read : 0}px`;
    this.edgeR.style.width = `${s.r !== null ? left : 0}px`;
    const w = this.o.pageWidth;
    this.edgeL.style.transform = `translateX(-100%)`;
    this.edgeR.style.transform = `translateX(${this.o.spreads ? w * 2 : w}px)`;
  }

  private begin(dir: 1 | -1): void {
    const k = dir > 0 ? this.index : this.index - 1;
    this.turn = { k, p: dir > 0 ? 0 : 1, raf: null, to: null };
    this.layoutTurn(k);
    this.root.classList.add("is-turning");
    this.leaf.hidden = false;
    this.o.onTurnStart?.();
    this.draw(this.turn.p);
  }

  /** Puts the turn at progress p. Only transforms and opacities change. */
  private draw(p: number): void {
    const t = this.turn;
    if (!t) return;
    t.p = p;
    const angle = -180 * p;
    this.leaf.style.transform = `rotateY(${angle}deg)`;
    const over = p >= 0.5;
    this.front.side.style.visibility = over ? "hidden" : "visible";
    this.back.side.style.visibility = over && this.o.spreads ? "visible" : "hidden";
    if (!this.o.spreads) this.back.side.style.visibility = over ? "visible" : "hidden";
    // The page darkens as it turns away from the light, the page it uncovers
    // comes out of its shadow, and the page it lands on goes into it.
    this.front.shade.style.opacity = String(Math.min(1, p * 2) * 0.55);
    this.back.shade.style.opacity = String(Math.min(1, (1 - p) * 2) * 0.55);
    this.right.shade.style.opacity = String((1 - p) * 0.5);
    this.left.shade.style.opacity = String(p * 0.5);
    const x = this.offset(t.k) + (this.offset(t.k + 1) - this.offset(t.k)) * easeInOut(p);
    this.shift.style.transform = `translateX(${x}px)`;
  }

  private animateTo(to: number, ms: number, ease: (t: number) => number): void {
    const t = this.turn;
    if (!t) return;
    const from = t.p;
    t.to = to;
    const started = performance.now();
    const step = (now: number) => {
      if (this.destroyed || this.turn !== t) return;
      const u = clamp01((now - started) / ms);
      this.draw(from + (to - from) * ease(u));
      if (u < 1) {
        t.raf = requestAnimationFrame(step);
      } else {
        t.raf = null;
        const landed = to === 1 ? t.k + 1 : t.k;
        this.settle(landed, landed !== this.index);
      }
    };
    t.raf = requestAnimationFrame(step);
  }

  /** Ends a turn under way where it was heading. */
  private finish(): void {
    const t = this.turn;
    if (!t) return;
    if (t.raf != null) cancelAnimationFrame(t.raf);
    // An animation lands where it was going; a page still held goes back.
    const heading = t.to === null ? this.index : t.to === 1 ? t.k + 1 : t.k;
    this.settle(heading, heading !== this.index);
  }

  private cancel(): void {
    if (this.turn?.raf != null) cancelAnimationFrame(this.turn.raf);
    this.turn = null;
  }

  private settle(i: number, notify = true): void {
    this.cancel();
    this.index = i;
    this.root.classList.remove("is-turning");
    this.leaf.hidden = true;
    this.leaf.style.transform = "";
    this.left.shade.style.opacity = "0";
    this.right.shade.style.opacity = "0";
    this.shift.style.transform = `translateX(${this.offset(i)}px)`;
    this.layoutStatic(i);
    this.edges(i);
    if (notify) this.o.onSettle(i);
    this.o.onIdle?.();
  }
}
