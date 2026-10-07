/**
 * Reading the NFC tags (NTAG213 stickers) on club kit. Client-only: every
 * browser and plugin touch happens inside a function, so importing this during
 * SSR or in a desktop browser is harmless.
 *
 * We only ever want the tag's factory UID (7 bytes on an NTAG213), formatted
 * "04:A1:2B:3C:4D:5E:6F". Three readers, picked by nfcSupport():
 *
 * - "native" on Android: @capgo/capacitor-nfc, which runs Android reader mode.
 *   Reader mode is continuous by nature; a one-shot scan stops after a tag.
 * - "native" on iOS: the app's own HikingNfc plugin
 *   (ios/App/App/NfcTagPlugin.swift), an NFCTagReaderSession, because the
 *   Capacitor 7 capgo plugin only opens an NDEF session, which hides the UID
 *   and fails on blank tags. iOS shows its own scanning sheet.
 * - "web": Web NFC (Chrome on Android, in a normal browser tab). The first
 *   scan() must come from a tap, because it may ask for permission.
 *
 * The native shells load the live site, so an app build from before NFC
 * support simply reports "none" here.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type NfcSupport = "native" | "web" | "none";

/** Why a session ended without an error. "done": a one-shot scan read its tag. */
export type ScanEndReason = "done" | "stopped" | "cancelled" | "timeout";

export interface ScanSession {
  stop(): Promise<void>;
}

export interface StartScanningOptions {
  /** Normalized UID; repeats inside debounceMs are already dropped. */
  onTag: (uid: string) => void;
  /** Plain words for the UI. Not called when the user just closes the iOS sheet. */
  onError?: (message: string) => void;
  /**
   * The session is over (so the UI can drop its "scanning" state). Called once,
   * after the last onTag/onError, except when you called stop() yourself.
   */
  onEnd?: (reason: ScanEndReason) => void;
  /** Shelf-audit mode: keep listening after each tag. */
  continuous?: boolean;
  /** Ignore the same UID again within this window. Default 2500. */
  debounceMs?: number;
}

export const IOS_ALERT_MESSAGE = "Hold the top of your phone near the kit tag";
export const DEFAULT_DEBOUNCE_MS = 2500;

// ---------------------------------------------------------------------------
// Pure helpers

/**
 * A tag UID as uppercase colon hex, or null if it isn't 4–10 bytes.
 * Accepts byte arrays (number[] / Uint8Array; Java's signed bytes are fine)
 * and hex strings with or without ":", "-" or space separators.
 */
export function formatUid(bytes: ArrayLike<number> | string): string | null {
  let parts: number[];
  if (typeof bytes === "string") {
    const s = bytes.trim();
    if (!s) return null;
    if (/[:\-\s]/.test(s)) {
      const groups = s.split(/[:\-\s]+/).filter(Boolean);
      // "4:a1:…" from a careless source: pad single digits rather than reject.
      if (!groups.every((g) => /^[0-9a-f]{1,2}$/i.test(g))) return null;
      parts = groups.map((g) => parseInt(g, 16));
    } else {
      const hex = s.replace(/^0x/i, "");
      if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
      parts = (hex.match(/../g) ?? []).map((g) => parseInt(g, 16));
    }
  } else {
    if (bytes == null || typeof bytes.length !== "number") return null;
    parts = [];
    for (let i = 0; i < bytes.length; i++) {
      const b = Number(bytes[i]);
      if (!Number.isInteger(b) || b < -128 || b > 255) return null;
      parts.push(b & 0xff);
    }
  }
  if (parts.length < 4 || parts.length > 10) return null;
  return parts.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
}

/**
 * Drops a UID seen again within windowMs of the last time it was *accepted*.
 * Holding a tag against the phone fires over and over; this makes that one read.
 * A different tag in between doesn't reset anything, so scanning A, B, A
 * quickly yields A, B (the second A is still inside A's window).
 */
export function createDebouncer(windowMs: number = DEFAULT_DEBOUNCE_MS, now: () => number = Date.now) {
  const lastAccepted = new Map<string, number>();
  return function accept(uid: string): boolean {
    const t = now();
    const prev = lastAccepted.get(uid);
    if (prev !== undefined && t - prev < windowMs) return false;
    lastAccepted.set(uid, t);
    // Keep the map small during a long shelf audit.
    if (lastAccepted.size > 200) {
      for (const [k, v] of lastAccepted) if (t - v >= windowMs) lastAccepted.delete(k);
    }
    return true;
  };
}

// ---------------------------------------------------------------------------
// Plugins

/** ios/App/App/NfcTagPlugin.swift */
interface HikingNfcPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  startScanning(options: { alertMessage: string; continuous: boolean }): Promise<void>;
  stopScanning(): Promise<void>;
  addListener(event: "tag", cb: (e: { uid: number[] }) => void): Promise<PluginListenerHandle>;
  addListener(
    event: "sessionEnded",
    cb: (e: { reason: "stopped" | "done" | "cancelled" | "timeout" | "error"; message?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

let hikingNfc: HikingNfcPlugin | null = null;
function iosPlugin(): HikingNfcPlugin {
  hikingNfc ??= registerPlugin<HikingNfcPlugin>("HikingNfc");
  return hikingNfc;
}

function nativePlatform(): "ios" | "android" | null {
  if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return null;
  const p = Capacitor.getPlatform();
  if (p === "ios" && Capacitor.isPluginAvailable("HikingNfc")) return "ios";
  if (p === "android" && Capacitor.isPluginAvailable("CapacitorNfc")) return "android";
  return null;
}

async function capgo() {
  return (await import("@capgo/capacitor-nfc")).CapacitorNfc;
}

// Android reader mode flags: NFC-A only (NTAG213 is ISO 14443-A), don't wait
// for an NDEF check (we only want the UID), and no system beep (we buzz).
const FLAG_READER_NFC_A = 0x1;
const FLAG_READER_SKIP_NDEF_CHECK = 0x80;
const FLAG_READER_NO_PLATFORM_SOUNDS = 0x100;
const ANDROID_READER_FLAGS = FLAG_READER_NFC_A | FLAG_READER_SKIP_NDEF_CHECK | FLAG_READER_NO_PLATFORM_SOUNDS;

// Web NFC isn't in TypeScript's DOM lib yet.
interface NdefReadingEvent extends Event {
  serialNumber: string;
}
interface NdefReaderLike extends EventTarget {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
}
type NdefReaderCtor = new () => NdefReaderLike;

function webNfc(): NdefReaderCtor | null {
  if (typeof window === "undefined" || !("NDEFReader" in window)) return null;
  return (window as unknown as { NDEFReader: NdefReaderCtor }).NDEFReader;
}

// ---------------------------------------------------------------------------
// Support

export interface NfcAvailability {
  support: NfcSupport;
  /** Set when support is "none" but turning NFC on in settings would fix it (Android). */
  disabled?: boolean;
}

/** Like nfcSupport(), but also says when NFC is just switched off. */
export async function nfcAvailability(): Promise<NfcAvailability> {
  const native = nativePlatform();
  try {
    if (native === "ios") {
      const { available } = await iosPlugin().isAvailable();
      return { support: available ? "native" : "none" };
    }
    if (native === "android") {
      const { status } = await (await capgo()).getStatus();
      if (status === "NFC_OK") return { support: "native" };
      return { support: "none", disabled: status === "NFC_DISABLED" };
    }
  } catch {
    return { support: "none" };
  }
  // Inside the app, Web NFC isn't there (WebViews don't have it), so an old
  // app build lands on "none" too.
  return { support: webNfc() ? "web" : "none" };
}

export async function nfcSupport(): Promise<NfcSupport> {
  return (await nfcAvailability()).support;
}

/** Opens the phone's NFC settings (Android app only; no-op elsewhere). */
export async function openNfcSettings(): Promise<void> {
  if (nativePlatform() !== "android") return;
  try {
    await (await capgo()).showSettings();
  } catch {
    // Nothing useful to say.
  }
}

// ---------------------------------------------------------------------------
// Scanning

const INERT: ScanSession = { stop: async () => {} };

export async function startScanning(opts: StartScanningOptions): Promise<ScanSession> {
  const accept = createDebouncer(opts.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  const continuous = opts.continuous ?? false;
  const native = nativePlatform();
  if (native === "ios") return startIos(opts, accept, continuous);
  if (native === "android") return startAndroid(opts, accept, continuous);
  const Reader = webNfc();
  if (Reader) return startWeb(Reader, opts, accept, continuous);
  opts.onError?.("This device can't read NFC tags.");
  return INERT;
}

type Accept = (uid: string) => boolean;

async function startIos(opts: StartScanningOptions, accept: Accept, continuous: boolean): Promise<ScanSession> {
  const plugin = iosPlugin();
  let stopped = false;
  let readThisSession = false;
  const handles: PluginListenerHandle[] = [];
  const cleanup = async () => {
    await Promise.all(handles.splice(0).map((h) => h.remove().catch(() => {})));
  };
  const begin = () => plugin.startScanning({ alertMessage: IOS_ALERT_MESSAGE, continuous });

  handles.push(
    await plugin.addListener("tag", (e) => {
      const uid = formatUid(e.uid);
      if (!uid || stopped || !accept(uid)) return;
      readThisSession = true;
      opts.onTag(uid);
    }),
    await plugin.addListener("sessionEnded", (e) => {
      if (stopped) return;
      // iOS ends every session after 60 seconds. In an audit that's still
      // going, open a fresh sheet; an idle one is allowed to end.
      if (e.reason === "timeout" && continuous && readThisSession) {
        readThisSession = false;
        begin().catch((err) => finish(() => opts.onError?.(errorMessage(err))));
        return;
      }
      finish(() => {
        if (e.reason === "error") opts.onError?.(e.message || "Couldn't read the tag. Try again.");
        else if (e.reason !== "stopped") opts.onEnd?.(e.reason);
      });
    }),
  );

  function finish(report: () => void) {
    if (stopped) return;
    stopped = true;
    void cleanup();
    report();
  }

  try {
    await begin();
  } catch (err) {
    finish(() => opts.onError?.(errorMessage(err)));
    return INERT;
  }

  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await plugin.stopScanning().catch(() => {});
      await cleanup();
    },
  };
}

async function startAndroid(opts: StartScanningOptions, accept: Accept, continuous: boolean): Promise<ScanSession> {
  const plugin = await capgo();
  let stopped = false;
  const handles: PluginListenerHandle[] = [];

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await plugin.stopScanning().catch(() => {});
    await Promise.all(handles.splice(0).map((h) => h.remove().catch(() => {})));
  };

  handles.push(
    await plugin.addListener("nfcEvent", (e) => {
      const uid = e.tag?.id ? formatUid(e.tag.id) : null;
      if (stopped) return;
      if (!uid) {
        opts.onError?.("Couldn't read that tag. Hold it still and try again.");
        return;
      }
      if (!accept(uid)) return;
      opts.onTag(uid);
      if (!continuous) void stop().then(() => opts.onEnd?.("done"));
    }),
    await plugin.addListener("nfcStateChange", (e) => {
      if (stopped || e.enabled) return;
      void stop().then(() => opts.onError?.("NFC was switched off. Turn it on in Settings to scan kit."));
    }),
  );

  try {
    await plugin.startScanning({ androidReaderModeFlags: ANDROID_READER_FLAGS });
  } catch (err) {
    await stop();
    opts.onError?.(errorMessage(err));
    return INERT;
  }
  return { stop };
}

async function startWeb(
  Reader: NdefReaderCtor,
  opts: StartScanningOptions,
  accept: Accept,
  continuous: boolean,
): Promise<ScanSession> {
  const controller = new AbortController();
  const reader = new Reader();
  const stop = async () => controller.abort();

  reader.addEventListener(
    "reading",
    (event) => {
      const uid = formatUid((event as NdefReadingEvent).serialNumber ?? "");
      if (controller.signal.aborted) return;
      if (!uid) {
        opts.onError?.("Couldn't read that tag's ID. Try again.");
        return;
      }
      if (!accept(uid)) return;
      opts.onTag(uid);
      if (!continuous) {
        controller.abort();
        opts.onEnd?.("done");
      }
    },
    { signal: controller.signal },
  );
  reader.addEventListener(
    "readingerror",
    () => opts.onError?.("Couldn't read that tag. Hold it still and try again."),
    { signal: controller.signal },
  );

  try {
    await reader.scan({ signal: controller.signal });
  } catch (err) {
    controller.abort();
    opts.onError?.(webErrorMessage(err));
    return INERT;
  }
  return { stop };
}

function errorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === "NO_NFC") return "This phone can't read NFC tags.";
  if (code === "NFC_DISABLED") return "NFC is switched off. Turn it on in Settings to scan kit.";
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return message || "Couldn't start the NFC reader. Try again.";
}

function webErrorMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === "NotAllowedError") return "NFC permission was refused. Allow it for this site in Chrome's settings.";
  if (name === "NotSupportedError") return "This phone can't read NFC tags, or NFC is switched off.";
  if (name === "NotReadableError") return "NFC is switched off. Turn it on in Settings to scan kit.";
  if (name === "AbortError") return "Scanning was stopped.";
  return "Couldn't start the NFC reader. Try again.";
}

// ---------------------------------------------------------------------------
// Feedback

let audio: AudioContext | null = null;

/**
 * A buzz for the result of a scan: "ok" one light tap, "unknown" (a tag we
 * don't know) two heavy pulses, "error" three quick pulses. Uses
 * @capacitor/haptics, which falls back to navigator.vibrate in browsers; a
 * no-op where neither exists (iPhone Safari, desktops).
 *
 * The short ping on "ok" is off by default (`sound: true` to turn it on): kit
 * gets scanned in shared rooms, and the haptic is enough.
 */
export function feedback(kind: "ok" | "unknown" | "error", options: { sound?: boolean } = {}): void {
  if (typeof window === "undefined") return;
  void (async () => {
    try {
      const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
      const pulse = (style: (typeof ImpactStyle)[keyof typeof ImpactStyle]) =>
        Haptics.impact({ style }).catch(() => {});
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      if (kind === "ok") {
        await pulse(ImpactStyle.Light);
      } else if (kind === "unknown") {
        await pulse(ImpactStyle.Heavy);
        await wait(180);
        await pulse(ImpactStyle.Heavy);
      } else {
        for (let i = 0; i < 3; i++) {
          if (i) await wait(90);
          await pulse(ImpactStyle.Medium);
        }
      }
    } catch {
      // No haptics here.
    }
  })();
  if (kind === "ok" && options.sound) ping();
}

function ping() {
  try {
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 1320;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.15, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  } catch {
    // Audio blocked or unavailable.
  }
}
