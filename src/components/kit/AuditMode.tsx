"use client";

import { useEffect, useRef, useState } from "react";
import { Nfc } from "lucide-react";
import { itemName } from "@/lib/equipmentItems";
import { auditSummary, plural, STATUS_LABELS } from "@/lib/kitScan";
import { feedback } from "@/lib/nfc";
import { useKit, type Outcome } from "./KitLender";
import { ScanLog, type LogEntry } from "./HandoverSheet";
import { NewTagForm } from "./NewTagForm";
import { NfcNotice } from "./NfcNotice";

/**
 * Shelf audit: keep the reader open and mark every tag it sees as audited
 * (and, if given, at this location). Unknown tags are listed to tag after;
 * tagged kit that should be on the shelf but wasn't seen is listed below.
 */
export function AuditMode() {
  const kit = useKit();
  const [location, setLocation] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [seenIds, setSeenIds] = useState<string[]>([]);
  const [seenUids, setSeenUids] = useState<string[]>([]);
  const [tagging, setTagging] = useState<string | null>(null);
  const handled = useRef(new Set<string>());
  const locationRef = useRef(location);
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  function record(entry: LogEntry) {
    setLog((list) => [entry, ...list.filter((e) => e.key !== entry.key)]);
  }

  function settle(uid: string, title: string, outcome: Outcome) {
    if (outcome.kind === "queued") {
      feedback("ok");
      record({ key: uid, title, type: "queued", text: "No signal: saved, and sent when you're back online." });
      return;
    }
    if (outcome.kind === "error") {
      if (outcome.unregistered) {
        feedback("unknown");
        record({ key: uid, title: uid, type: "unknown", text: "Not tagged yet" });
      } else {
        handled.current.delete(uid);
        setSeenUids((list) => list.filter((u) => u !== uid));
        feedback("error");
        record({ key: uid, title, type: "error", text: outcome.error });
      }
      return;
    }
    feedback("ok");
    const item = outcome.result.item;
    if (item) setSeenIds((list) => (list.includes(item.id) ? list : [...list, item.id]));
    record({
      key: uid,
      title: item ? `${item.asset_code}${item.label ? ` · ${item.label}` : ""}` : title,
      type: "ok",
      text: item ? `${item.equipment_name} · ${STATUS_LABELS[item.status]}` : "Audited",
    });
  }

  const scanOp = kit?.scanOp;
  const setTagHandler = kit?.setTagHandler;
  const items = kit?.items;

  useEffect(() => {
    if (!scanOp || !setTagHandler) return;
    setTagHandler((uid) => {
      if (handled.current.has(uid)) return;
      handled.current.add(uid);
      setSeenUids((list) => [...list, uid]);
      const known = items?.find((i) => i.tag_uid === uid);
      const title = known ? itemName(known) : uid;
      record({ key: uid, title, type: "pending", text: "Saving…" });
      const where = locationRef.current.trim() || undefined;
      void scanOp({ action: "audit", uid, location: where }, `Audit ${title}`).then((o) => settle(uid, title, o));
    });
    return () => setTagHandler(null);
    // record/settle only touch state setters and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanOp, setTagHandler, items]);

  if (!kit) return null;

  if (tagging) {
    return (
      <NewTagForm
        uid={tagging}
        defaultLocation={location}
        onCancel={() => setTagging(null)}
        onDone={(item) => {
          record({
            key: tagging,
            title: item ? `${item.asset_code}${item.label ? ` · ${item.label}` : ""}` : tagging,
            type: item ? "ok" : "queued",
            text: item ? `Tagged as ${item.equipment_name}` : "Tag saved on this phone; sent when back online.",
          });
          if (item) setSeenIds((list) => [...list, item.id]);
          setTagging(null);
        }}
      />
    );
  }

  const { scan } = kit;
  const unsupported = kit.nfc?.support === "none";
  const summary = auditSummary(kit.items, seenIds, seenUids);
  const unknown = log.filter((e) => e.type === "unknown").length;
  const seenCount = log.filter((e) => e.type === "ok" || e.type === "queued").length;

  return (
    <div className="kit-mode">
      <p className="event-section-title">Shelf audit</p>
      <h3 id="kit-sheet-title">Audit shelf</h3>
      <p className="kit-card-lede">Scan every tag on the shelf. Each one is marked as seen today.</p>

      <label className="kit-field">
        <span>Location (optional)</span>
        <input
          type="text"
          placeholder="e.g. Kit room, shelf B"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <span className="kit-field-hint">Set before you scan: every item scanned is moved here.</span>
      </label>

      <NfcNotice nfc={kit.nfc} native={kit.native} />
      {!unsupported && (
        <div className={`kit-scan-target${scan.active ? " is-active" : ""}`}>
          <Nfc size={22} aria-hidden="true" />
          <span>{scan.active ? "Scanning: move along the shelf" : "Not scanning"}</span>
          {scan.active ? (
            <button type="button" className="kit-btn" onClick={kit.stopScan}>
              Stop
            </button>
          ) : (
            <button type="button" className="kit-btn primary" onClick={() => kit.startScan(true)}>
              {log.length ? "Carry on scanning" : "Start scanning"}
            </button>
          )}
        </div>
      )}
      {scan.error && (
        <p className="kit-scan-error" role="alert">
          {scan.error}
        </p>
      )}

      <p className="kit-progress-line" role="status" aria-live="polite">
        {plural(seenCount, "item")} seen
        {unknown ? ` · ${plural(unknown, "unknown tag")}` : ""}
        {summary.expected ? ` · ${summary.notSeen.length} of ${summary.expected} on the shelf list not seen` : ""}
      </p>

      {log.length > 0 && (
        <ScanLog
          entries={log}
          onTag={(uid) => {
            kit.stopScan();
            setTagging(uid);
          }}
        />
      )}

      {log.length > 0 && summary.notSeen.length > 0 && (
        <details className="kit-not-seen">
          <summary>
            Not seen ({summary.notSeen.length})
            {summary.onLoan ? <span> · {summary.onLoan} on loan, not counted</span> : null}
          </summary>
          <ul className="kit-list">
            {summary.notSeen.map((i) => {
              const full = kit.items.find((x) => x.id === i.id);
              return (
                <li key={i.id} className="kit-log-row">
                  <span className="kit-log-body">
                    <span className="kit-log-title">
                      <span className="kit-asset">{i.asset_code}</span>
                      {full?.label ? ` · ${full.label}` : ""}
                    </span>
                    <span className="kit-log-text">
                      {full?.equipment_name}
                      {full?.location ? ` · ${full.location}` : ""}
                    </span>
                  </span>
                  <span className={`kit-tag is-${i.status}`}>{STATUS_LABELS[i.status]}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <div className="modal-actions">
        <button type="button" className="kit-btn" onClick={kit.close}>
          {log.length ? "Finish" : "Close"}
        </button>
      </div>
    </div>
  );
}
