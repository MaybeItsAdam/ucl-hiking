"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Nfc } from "lucide-react";
import { itemName, type ItemSummary } from "@/lib/equipmentItems";
import { handoverProgress } from "@/lib/kitScan";
import { feedback } from "@/lib/nfc";
import { useKit, type LenderRequest, type Outcome } from "./KitLender";
import { NfcNotice } from "./NfcNotice";
import { ItemSearch } from "./ScanSheet";
import { borrowerOf, formatDays } from "./format";

export type LogType = "pending" | "ok" | "queued" | "unknown" | "error";
export interface LogEntry {
  key: string;
  title: string;
  text: string;
  type: LogType;
}

/**
 * Handover from an approved request: keep the reader open and check out every
 * item scanned against this request, until it has as many as were asked for.
 */
export function HandoverSheet({ request }: { request: LenderRequest }) {
  const kit = useKit();
  const [itemsOut, setItemsOut] = useState(request.items?.length ?? 0);
  const [queued, setQueued] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const handled = useRef(new Set<string>());

  const progress = handoverProgress(request.quantity, itemsOut, queued);
  const complete = progress.complete;
  const kindName = request.equipment?.name ?? "kit";

  // A handover is a run of scans; the latest outcome goes to the top.
  function record(entry: LogEntry) {
    setLog((list) => [entry, ...list.filter((e) => e.key !== entry.key)].slice(0, 30));
  }

  function settle(key: string, title: string, outcome: Outcome) {
    if (outcome.kind === "queued") {
      feedback("ok");
      setQueued((n) => n + 1);
      record({ key, title, type: "queued", text: "No signal: saved, and sent when you're back online." });
      return;
    }
    if (outcome.kind === "error") {
      handled.current.delete(key);
      feedback(outcome.unregistered ? "unknown" : "error");
      record({
        key,
        title,
        type: outcome.unregistered ? "unknown" : "error",
        text: outcome.unregistered ? "This tag isn't on any item yet. Tag it from Scan first." : outcome.error,
      });
      return;
    }
    const { result } = outcome;
    feedback("ok");
    const name = result.item ? itemName(result.item) : title;
    if (result.loan) setItemsOut((n) => Math.max(n, result.loan!.itemsOut));
    else if (!result.noop && !result.duplicate) setItemsOut((n) => n + 1);
    record({ key, title: name, type: "ok", text: result.noop ? result.message || "Already handed over." : "Handed over" });
  }

  const scanOp = kit?.scanOp;
  const act = kit?.act;
  const setTagHandler = kit?.setTagHandler;
  const stopScan = kit?.stopScan;
  const borrower = borrowerOf(request);

  const completeRef = useRef(complete);
  useEffect(() => {
    completeRef.current = complete;
  }, [complete]);

  useEffect(() => {
    if (!scanOp || !setTagHandler) return;
    setTagHandler((uid) => {
      if (completeRef.current || handled.current.has(uid)) return;
      handled.current.add(uid);
      const known = kit?.items.find((i) => i.tag_uid === uid);
      const title = known ? itemName(known) : uid;
      record({ key: uid, title, type: "pending", text: "Saving…" });
      void scanOp({ action: "check_out", uid, requestId: request.id }, `Hand ${title} to ${borrower}`).then((o) => settle(uid, title, o));
    });
    return () => setTagHandler(null);
    // settle/record only use state setters and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanOp, setTagHandler, request.id, borrower, kit?.items]);

  // Enough items: stop listening.
  useEffect(() => {
    if (complete && kit?.scan.active) stopScan?.();
  }, [complete, kit?.scan.active, stopScan]);

  if (!kit || !act) return null;

  function pick(item: ItemSummary) {
    if (!act || complete || handled.current.has(item.tag_uid ?? item.id)) return;
    const key = item.tag_uid ?? item.id;
    handled.current.add(key);
    record({ key, title: itemName(item), type: "pending", text: "Saving…" });
    void act(item.id, { action: "check_out", requestId: request.id }, `Hand ${itemName(item)} to ${borrower}`).then((o) =>
      settle(key, itemName(item), o),
    );
  }

  const { scan } = kit;
  const unsupported = kit.nfc?.support === "none";

  return (
    <div className="kit-mode">
      <p className="event-section-title">Hand over</p>
      <h3 id="kit-sheet-title">
        {request.quantity}× {kindName} to {borrower}
      </h3>
      <p className="kit-card-lede">{formatDays(request.start_date, request.end_date)}</p>

      <div className={`kit-progress${complete ? " is-complete" : ""}`} role="status" aria-live="polite">
        <strong>{progress.label}</strong>
        <span className="kit-progress-bar" aria-hidden="true">
          <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
        </span>
      </div>

      <NfcNotice nfc={kit.nfc} native={kit.native} />
      {!unsupported && !complete && (
        <div className={`kit-scan-target${scan.active ? " is-active" : ""}`}>
          <Nfc size={22} aria-hidden="true" />
          <span>{scan.active ? `Scan each ${kindName.toLowerCase()} as you hand it over` : "Not scanning"}</span>
          {scan.active ? (
            <button type="button" className="kit-btn" onClick={kit.stopScan}>
              Stop
            </button>
          ) : (
            <button type="button" className="kit-btn primary" onClick={() => kit.startScan(true)}>
              Start scanning
            </button>
          )}
        </div>
      )}
      {scan.error && !complete && (
        <p className="kit-scan-error" role="alert">
          {scan.error}
        </p>
      )}

      {log.length > 0 && <ScanLog entries={log} />}

      {!complete && (
        <ItemSearch
          placeholder={`Find a ${kindName.toLowerCase()} by asset code`}
          filter={(i) => i.equipment_id === request.equipment_id && (i.status === "available" || i.status === "missing")}
          onPick={pick}
        />
      )}

      <div className="modal-actions">
        <button type="button" className={`kit-btn${complete ? " primary" : ""}`} onClick={kit.close}>
          {complete ? "Done" : "Close"}
        </button>
      </div>
    </div>
  );
}

export function ScanLog({ entries, onTag }: { entries: LogEntry[]; onTag?: (uid: string) => void }) {
  return (
    <ul className="kit-list kit-scan-log" aria-live="polite">
      {entries.map((e) => (
        <li key={e.key} className={`kit-log-row is-${e.type}`}>
          <span className="kit-log-mark" aria-hidden="true">
            {e.type === "pending" ? <Loader2 size={14} className="roster-spinner" /> : null}
          </span>
          <span className="kit-log-body">
            <span className="kit-log-title">{e.title}</span>
            <span className="kit-log-text">{e.text}</span>
          </span>
          {e.type === "unknown" && onTag && (
            <button type="button" className="kit-btn" onClick={() => onTag(e.key)}>
              Tag it
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
