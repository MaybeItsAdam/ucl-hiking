"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Loader2, Nfc } from "lucide-react";
import type { PublicItemView } from "@/lib/equipmentItems";
import { restrictionLabel } from "@/lib/kitCustody";
import { STATUS_LABELS } from "@/lib/kitScan";
import { feedback, nfcAvailability, startScanning, type NfcAvailability, type ScanSession } from "@/lib/nfc";
import { NfcNotice } from "./NfcNotice";
import { CONDITION_LABELS } from "./format";

type Found = PublicItemView & { ok?: boolean; message?: string };

/**
 * Scanning for any member: hold the phone to a tag to see what it is and who
 * has it, and, when someone has just passed it to you, confirm "I've got it".
 * Kit handlers get the full scanner (KitLender) instead.
 *
 * `itemId` opens straight on an item (a link to it, or a tag that carries one).
 */
export function MemberScan({ itemId, onClaimed }: { itemId?: string | null; onClaimed?: () => void }) {
  const [nfc, setNfc] = useState<NfcAvailability | null>(null);
  const [native] = useState(() => typeof window !== "undefined" && Capacitor.isNativePlatform());
  const [scanning, setScanning] = useState(false);
  const [looking, setLooking] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const session = useRef<ScanSession | null>(null);

  const show = useCallback(async (url: string) => {
    setLooking(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(url, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as Found & { error?: string; unregistered?: boolean };
      if (res.ok && data.item) {
        feedback("ok");
        setFound(data);
      } else {
        feedback(data.unregistered ? "unknown" : "error");
        setFound(null);
        setError(data.unregistered ? "That tag isn't on any club kit yet." : data.error || "Couldn't look that up.");
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setLooking(false);
    }
  }, []);

  const stop = useCallback(() => {
    const s = session.current;
    session.current = null;
    setScanning(false);
    void s?.stop();
  }, []);

  /** Must run inside a tap: Web NFC asks for permission on the first scan. */
  const scan = useCallback(() => {
    stop();
    setScanning(true);
    setError(null);
    void startScanning({
      onTag: (uid) => {
        stop();
        void show(`/api/equipment/items/by-tag/${encodeURIComponent(uid)}`);
      },
      onError: (message) => {
        setError(message);
        setScanning(false);
      },
      onEnd: () => setScanning(false),
    }).then((s) => {
      session.current = s;
    });
  }, [show, stop]);

  useEffect(() => {
    let alive = true;
    void nfcAvailability().then((a) => {
      if (alive) setNfc(a);
    });
    return () => {
      alive = false;
      void session.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!itemId) return;
    const t = setTimeout(() => void show(`/api/equipment/items/${encodeURIComponent(itemId)}`), 0);
    return () => clearTimeout(t);
  }, [itemId, show]);

  async function claim() {
    if (!found) return;
    setClaiming(true);
    setError(null);
    try {
      const res = await fetch(`/api/equipment/items/${found.item.id}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: crypto.randomUUID?.() ?? String(Date.now()), at: new Date().toISOString() }),
      });
      const data = (await res.json().catch(() => ({}))) as Found & { error?: string };
      if (!res.ok || !data.item) {
        feedback("error");
        setError(data.error || "Couldn't record that. Try again.");
        return;
      }
      feedback("ok");
      setFound(data);
      setNote(data.message || "Done: it's down as being with you now.");
      onClaimed?.();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setClaiming(false);
    }
  }

  const unsupported = nfc?.support === "none";
  const item = found?.item;
  const restricted = item ? restrictionLabel(item.restricted_to) : null;

  return (
    <div className="kit-card">
      <p className="event-section-title">Scan kit</p>
      {!item && <h3 id="member-scan-title">What is this?</h3>}
      {item && (
        <h3 id="member-scan-title">
          <span className="kit-asset">{item.asset_code}</span>
          {item.label ? <span className="kit-card-label">{item.label}</span> : null}
        </h3>
      )}

      {item ? (
        <dl className="kit-facts">
          <div>
            <dt>Kit</dt>
            <dd>{item.equipment_name}</dd>
          </div>
          <div>
            <dt>Condition</dt>
            <dd>
              <span className={`kit-tag is-${item.condition}`}>{CONDITION_LABELS[item.condition]}</span>
            </dd>
          </div>
          <div className="is-wide">
            <dt>Where it is</dt>
            <dd>
              {item.status === "on_loan" ? (
                found?.yours ? "With you" : `With ${item.holder?.name ?? "a club member"}`
              ) : (
                <span className={`kit-tag is-${item.status}`}>{item.status === "available" ? "In storage" : STATUS_LABELS[item.status]}</span>
              )}
            </dd>
          </div>
          {restricted && (
            <div className="is-wide">
              <dt>Who can take it</dt>
              <dd>
                <span className="kit-tag is-restricted">{restricted}</span>
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="kit-card-lede">Hold your phone to the tag on any piece of club kit to see what it is and who has it.</p>
      )}

      {found && item && item.status === "on_loan" && !found.yours && (
        <div className="kit-card-panel">
          {found.canClaim ? (
            <>
              <p className="kit-card-empty">
                Has {item.holder?.name ?? "someone"} just given you this? Confirm it, so the club knows it&apos;s with you now.
              </p>
              <div className="kit-card-submit">
                <button type="button" className="kit-btn primary" disabled={claiming} onClick={() => void claim()}>
                  {claiming ? "Saving…" : "I've got it now"}
                </button>
              </div>
            </>
          ) : (
            found.restricted && <p className="kit-card-empty">{found.restricted}</p>
          )}
        </div>
      )}
      {found && item && item.status !== "on_loan" && (
        <p className="kit-card-empty">
          It&apos;s in storage. To borrow it, ask from the Equipment page and a committee member will arrange to meet you.
        </p>
      )}

      <NfcNotice nfc={nfc} native={native} />
      {!unsupported && (
        <div className={`kit-scan-target${scanning ? " is-active" : ""}`} role="status" aria-live="polite">
          {looking ? <Loader2 size={22} className="roster-spinner" aria-hidden="true" /> : <Nfc size={22} aria-hidden="true" />}
          <span>{looking ? "Looking it up…" : scanning ? "Hold the top of the phone near the kit tag" : "Not scanning"}</span>
          {scanning ? (
            <button type="button" className="kit-btn" onClick={stop}>
              Stop
            </button>
          ) : (
            !looking && (
              <button type="button" className="kit-btn primary" onClick={scan}>
                {item ? "Scan another" : "Scan a tag"}
              </button>
            )
          )}
        </div>
      )}

      {note && (
        <p className="kit-card-note is-ok" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="kit-card-note is-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
