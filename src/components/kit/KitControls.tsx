"use client";

import { useState } from "react";
import { ClipboardCheck, CloudOff, Nfc, X } from "lucide-react";
import { ITEM_STATUSES, type ItemStatus } from "@/lib/equipmentItems";
import { handoverProgress, plural, STATUS_LABELS } from "@/lib/kitScan";
import { useKit, type LenderRequest } from "./KitLender";

/**
 * The lender's bar at the top of the Equipment tab: Scan, Audit shelf, and
 * the scans waiting for signal. Renders nothing for anyone else.
 */
export function KitScanBar() {
  const kit = useKit();
  if (!kit) return null;
  const waiting = kit.queue.length;
  return (
    <div className="kit-scan-bar">
      <div className="kit-scan-bar-actions">
        <button type="button" className="kit-btn primary" onClick={kit.openScan}>
          <Nfc size={16} aria-hidden="true" />
          Scan
        </button>
        <button type="button" className="kit-btn" onClick={kit.openAudit}>
          <ClipboardCheck size={16} aria-hidden="true" />
          Audit shelf
        </button>
      </div>
      {waiting > 0 && (
        <div className="kit-queue" role="status">
          <CloudOff size={15} aria-hidden="true" />
          <span>
            {plural(waiting, "scan")} waiting{kit.online ? "" : " for signal"}
          </span>
          {kit.online && (
            <button type="button" className="kit-btn" onClick={() => void kit.flush()}>
              Send now
            </button>
          )}
        </div>
      )}
      {kit.failures.length > 0 && (
        <div className="kit-queue is-error" role="alert">
          <div className="kit-queue-failures">
            <strong>{plural(kit.failures.length, "scan")} couldn&apos;t be saved</strong>
            <ul>
              {kit.failures.map((f) => (
                <li key={f.clientId}>
                  {f.label}: {f.error}
                </li>
              ))}
            </ul>
          </div>
          <button type="button" className="kit-queue-dismiss" onClick={kit.dismissFailures} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

/** "Scan items" on an approved request, with how many tagged items are already out. */
export function HandoverButton({ request }: { request: LenderRequest }) {
  const kit = useKit();
  if (!kit || request.status !== "approved") return null;
  const progress = handoverProgress(request.quantity, request.items?.length ?? 0);
  if (progress.complete) {
    return (
      <span className="kit-handover-done" title={progress.label}>
        {progress.done}/{progress.total} tagged out
      </span>
    );
  }
  return (
    <button type="button" className="kit-btn kit-handover" onClick={() => kit.openHandover(request)} title={progress.label}>
      <Nfc size={15} aria-hidden="true" />
      Scan items{progress.done ? ` ${progress.done}/${progress.total}` : ""}
    </button>
  );
}

type StatusFilter = ItemStatus | "all";

/** Every tagged item, filterable by status, so missing and broken kit shows up. */
export function TaggedItemsList() {
  const kit = useKit();
  const [filter, setFilter] = useState<StatusFilter>("all");
  if (!kit) return null;
  const { items } = kit;
  const counts = Object.fromEntries(ITEM_STATUSES.map((s) => [s, items.filter((i) => i.status === s).length])) as Record<
    ItemStatus,
    number
  >;
  const visible = (filter === "all" ? items : items.filter((i) => i.status === filter))
    .slice()
    .sort((a, b) => a.asset_code.localeCompare(b.asset_code));

  return (
    <section className="kit-tagged" aria-labelledby="kit-tagged-title">
      <p id="kit-tagged-title" className="event-section-title">
        Tagged items
      </p>
      {items.length === 0 ? (
        <p className="kit-tagged-empty">
          {kit.itemsLoaded ? "Nothing is tagged yet. Scan a new tag to add the first item." : "Loading tagged kit…"}
        </p>
      ) : (
        <>
          <div className="roster-filters kit-filters" role="group" aria-label="Filter tagged items">
            {(["all", ...ITEM_STATUSES] as StatusFilter[]).map((s) => {
              const count = s === "all" ? items.length : counts[s];
              if (s !== "all" && count === 0 && filter !== s) return null;
              return (
                <button
                  key={s}
                  type="button"
                  className={filter === s ? "active" : ""}
                  aria-pressed={filter === s}
                  onClick={() => setFilter(s)}
                >
                  {s === "all" ? "All" : STATUS_LABELS[s]}
                  <span className="roster-filter-count">{count}</span>
                </button>
              );
            })}
          </div>
          <ul className="kit-list">
            {visible.map((item) => (
              <li key={item.id} className="kit-item">
                <button
                  type="button"
                  className="kit-item-main"
                  onClick={() => kit.openItem({ item, offline: !kit.online })}
                  aria-label={`${item.asset_code}${item.label ? `, ${item.label}` : ""}: ${STATUS_LABELS[item.status]}`}
                >
                  <span className="kit-item-name">
                    <span className="kit-asset">{item.asset_code}</span>
                    {item.label ? ` · ${item.label}` : ""}
                  </span>
                  <span className="kit-item-meta">
                    {item.equipment_name}
                    {item.location ? ` · ${item.location}` : ""}
                    {item.tag_uid ? null : <span className="kit-tag">No tag</span>}
                  </span>
                </button>
                <span className={`kit-tag is-${item.status}`}>{STATUS_LABELS[item.status]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
