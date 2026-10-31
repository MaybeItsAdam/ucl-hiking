"use client";

import { useEffect, useRef, useState } from "react";
import { Check, HardDriveDownload, LoaderCircle, Trash2 } from "lucide-react";
import { formatBytes } from "@/lib/navigator";
import { openIssueFile } from "@/lib/navigatorFile";
import { hasAllChunks, isSaved, removeIssue, setSaved } from "@/lib/navigatorStore";

type State = { kind: "checking" } | { kind: "idle" } | { kind: "saving"; progress: number } | { kind: "saved" } | { kind: "failed" };

/**
 * Keeps a whole issue on this device, so the reader opens it without
 * downloading anything, or lets go of it. The bytes go where the reader keeps
 * the ranges it reads anyway (IndexedDB), and a saved issue is never trimmed.
 */
export function NavigatorSave({ issue, version, bytes }: { issue: number; version: string; bytes: number }) {
  const [state, setState] = useState<State>({ kind: "checking" });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const saved = (await isSaved(version)) && (await hasAllChunks(version, bytes));
      if (live) setState({ kind: saved ? "saved" : "idle" });
    })();
    return () => {
      live = false;
      abort.current?.abort();
    };
  }, [version, bytes]);

  async function save() {
    const controller = new AbortController();
    abort.current = controller;
    setState({ kind: "saving", progress: 0 });
    try {
      // A record from the start, so a save cut short is still trimmed like any other read.
      await setSaved(version, issue, false);
      const file = await openIssueFile(`/api/navigator/${issue}`, version, bytes, controller.signal);
      if (!file) throw new Error("The file has changed");
      await file.cache.fetchAll((progress) => setState({ kind: "saving", progress }), controller.signal);
      await file.cache.flush();
      if (!(await hasAllChunks(version, bytes)) || !(await setSaved(version, issue, true))) throw new Error("Storage refused");
      setState({ kind: "saved" });
    } catch {
      if (controller.signal.aborted) setState({ kind: "idle" });
      else setState({ kind: "failed" });
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }

  async function remove() {
    abort.current?.abort();
    await removeIssue(version);
    setState({ kind: "idle" });
  }

  if (state.kind === "checking") return <div className="navigator-save" aria-hidden="true" />;

  if (state.kind === "saving") {
    const pct = Math.round(state.progress * 100);
    return (
      <div className="navigator-save">
        <button type="button" className="navigator-save-btn is-busy" onClick={() => abort.current?.abort()} aria-label={`Saving to this device, ${pct}%. Cancel`}>
          <LoaderCircle size={16} aria-hidden="true" className="navigator-spin" />
          <span>Saving {pct}%</span>
          <span className="navigator-save-bar" style={{ transform: `scaleX(${state.progress})` }} aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (state.kind === "saved") {
    return (
      <div className="navigator-save">
        <span className="navigator-save-status">
          <Check size={14} aria-hidden="true" /> On this device
        </span>
        <button type="button" className="navigator-save-btn is-quiet" onClick={remove}>
          <Trash2 size={16} aria-hidden="true" />
          <span>Remove from device</span>
        </button>
      </div>
    );
  }

  return (
    <div className="navigator-save">
      <button type="button" className="navigator-save-btn" onClick={save}>
        <HardDriveDownload size={16} aria-hidden="true" />
        <span>
          Save to device <span className="navigator-download-size">· {formatBytes(bytes)}</span>
        </span>
      </button>
      {state.kind === "failed" ? <span className="navigator-download-note">Couldn&rsquo;t save it just now. Try again on Wi-Fi.</span> : null}
    </div>
  );
}
