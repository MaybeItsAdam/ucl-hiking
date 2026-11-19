"use client";

import { useEffect, useRef, useState } from "react";
import { isPendingItem } from "@/lib/kitScan";
import { kitItemUrl } from "@/lib/kitTag";
import { feedback, nfcWriteSupport, writeKitTag, type WriteSupport } from "@/lib/nfc";

type Phase = { kind: "idle" } | { kind: "writing"; hint?: string } | { kind: "done" } | { kind: "error"; error: string };

/**
 * "Write link to tag": puts the item's public URL (and a line of text) on its
 * NFC tag, so a phone that isn't in the app sees it's club kit and opens the
 * app or /kit/<id>. Writing only lands on the item's own tag when its UID is
 * known. Renders nothing where tags can't be written, and for an item still
 * waiting to be sent (it has no id yet).
 *
 * `prominent` is the just-tagged screen: the button is the main action there.
 */
export function TagWriter({
  item,
  uid,
  prominent = false,
}: {
  item: { id: string; asset_code: string };
  uid: string | null;
  prominent?: boolean;
}) {
  const [support, setSupport] = useState<WriteSupport | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    void nfcWriteSupport().then((s) => {
      if (alive) setSupport(s);
    });
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, []);

  if (!support || support === "none" || isPendingItem(item)) return null;

  if (support === "update") {
    return (
      <div className="kit-card-panel kit-tag-writer">
        <p className="kit-field-hint">
          Update the app to write {item.asset_code}&apos;s link onto its tag, so any phone that taps it sees it&apos;s
          club kit.
        </p>
      </div>
    );
  }

  async function write() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ kind: "writing" });
    const result = await writeKitTag({
      item,
      expectedUid: uid,
      signal: controller.signal,
      onHint: (hint) => setPhase({ kind: "writing", hint }),
    });
    if (abort.current !== controller) return;
    abort.current = null;
    if (result.ok) {
      feedback("ok");
      setPhase({ kind: "done" });
    } else if (result.cancelled) {
      setPhase({ kind: "idle" });
    } else {
      feedback("error");
      setPhase({ kind: "error", error: result.error });
    }
  }

  const url = kitItemUrl(item.id);

  return (
    <div className="kit-card-panel kit-tag-writer">
      {phase.kind === "done" ? (
        <p className="kit-card-note" role="status">
          Link written. Any phone that taps {item.asset_code} now opens it in the app, or its page on the website.
        </p>
      ) : phase.kind === "writing" ? (
        <>
          <p className="kit-tag-writer-status" role="status">
            {phase.hint ?? `Hold the top of the phone to ${item.asset_code}'s tag…`}
          </p>
          <div className="kit-card-submit">
            <button type="button" className="kit-btn" onClick={() => abort.current?.abort()}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="kit-field-hint">
            {prominent
              ? "Now write its link onto the tag, so any phone that taps it sees it's club kit."
              : "Write this item's link onto its tag, so any phone that taps it sees it's club kit and can open it."}{" "}
            <span className="kit-asset kit-tag-writer-url">{url.replace(/^https?:\/\//, "")}</span>
          </p>
          {phase.kind === "error" && (
            <p className="kit-form-error" role="alert">
              {phase.error}
            </p>
          )}
          <div className={prominent ? "modal-actions" : "kit-card-submit"}>
            <button type="button" className={`kit-btn${prominent ? " primary" : ""}`} onClick={() => void write()}>
              {phase.kind === "error" ? "Try again" : "Write link to tag"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
