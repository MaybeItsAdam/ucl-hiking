// page-flip 2.0.7 (StPageFlip) ships its ES module without type declarations.
// These cover the part of its API the Navigator reader uses; the names and
// shapes are from the package's own src/ (PageFlip.ts, Settings.ts).
declare module "page-flip/dist/js/page-flip.module.js" {
  export type FlipCorner = "top" | "bottom";
  export type FlippingState = "user_fold" | "fold_corner" | "flipping" | "read";
  export type Orientation = "portrait" | "landscape";

  export interface FlipSetting {
    startPage: number;
    size: "fixed" | "stretch";
    width: number;
    height: number;
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
    drawShadow: boolean;
    flippingTime: number;
    usePortrait: boolean;
    startZIndex: number;
    autoSize: boolean;
    maxShadowOpacity: number;
    showCover: boolean;
    mobileScrollSupport: boolean;
    clickEventForward: boolean;
    useMouseEvents: boolean;
    swipeDistance: number;
    showPageCorners: boolean;
    disableFlipByClick: boolean;
  }

  export interface WidgetEvent {
    data: number | string | boolean | object;
    object: PageFlip;
  }

  export class PageFlip {
    constructor(element: HTMLElement, settings: Partial<FlipSetting>);
    loadFromHTML(items: HTMLElement[]): void;
    destroy(): void;
    update(): void;
    turnToPage(pageIndex: number): void;
    flip(pageIndex: number, corner?: FlipCorner): void;
    flipNext(corner?: FlipCorner): void;
    flipPrev(corner?: FlipCorner): void;
    getCurrentPageIndex(): number;
    getPageCount(): number;
    getState(): FlippingState;
    getOrientation(): Orientation;
    /** Starts a drag at a point relative to the book's block. */
    startUserTouch(pos: { x: number; y: number }): void;
    /** Feeds a finger position (relative to the book's block) to a drag in progress. */
    userMove(pos: { x: number; y: number }, isTouch: boolean): void;
    userStop(pos: { x: number; y: number }, isSwipe?: boolean): void;
    on(event: "flip" | "changeState" | "changeOrientation" | "init" | "update", callback: (e: WidgetEvent) => void): this;
  }
}
