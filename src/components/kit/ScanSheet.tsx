"use client";

import { useEffect, useState } from "react";
import { Loader2, Nfc, Search, X } from "lucide-react";
import type { ItemSummary } from "@/lib/equipmentItems";
import { matchItems, STATUS_LABELS } from "@/lib/kitScan";
import { feedback } from "@/lib/nfc";
import { useKit, type ScanView } from "./KitLender";
import { ItemCard } from "./ItemCard";
import { NewTagForm } from "./NewTagForm";
import { NfcNotice } from "./NfcNotice";

/**
 * The Scan sheet: a one-shot read, with a search by asset code beside it for
 * phones that can't scan (or tags that won't read). A read tag becomes its
 * item card; an unknown one becomes the "New tag" form.
 */
export function ScanSheet({ view, onView }: { view: ScanView; onView: (v: ScanView) => void }) {
  const kit = useKit();
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookupTag = kit?.lookupTag;
  const setTagHandler = kit?.setTagHandler;
  useEffect(() => {
    if (!lookupTag || !setTagHandler) return;
    setTagHandler((uid) => {
      setLooking(true);
      setError(null);
      void lookupTag(uid).then((found) => {
        setLooking(false);
        if (found.kind === "error") {
          feedback("error");
          setError(found.error);
          return;
        }
        feedback(found.kind === "item" ? "ok" : "unknown");
        if (found.kind === "item" || found.kind === "new") onView(found);
      });
    });
    return () => setTagHandler(null);
  }, [lookupTag, setTagHandler, onView]);

  if (!kit) return null;

  const scanAnother = () => {
    onView({ kind: "scan" });
    kit.startScan(false);
  };

  if (view.kind === "item") {
    return (
      <>
        <ItemCard view={view} />
        <div className="modal-actions">
          <button type="button" className="kit-btn" onClick={kit.close}>
            Done
          </button>
          <button type="button" className="kit-btn primary" onClick={scanAnother}>
            <Nfc size={16} aria-hidden="true" />
            Scan another
          </button>
        </div>
      </>
    );
  }

  if (view.kind === "new") {
    return (
      <NewTagForm
        uid={view.uid}
        offline={view.offline}
        onDone={(item) => (item ? onView({ kind: "item", item }) : kit.close())}
        onCancel={kit.close}
      />
    );
  }

  return (
    <>
      <h3 id="kit-sheet-title">Scan kit</h3>
      <ScanPrompt looking={looking} error={error} onStart={() => kit.startScan(false)} />
      <ItemSearch onPick={(item) => onView({ kind: "item", item, offline: !kit.online })} />
    </>
  );
}

/** "Hold the phone near the tag", or the reason it can't, and a button to try again. */
function ScanPrompt({ looking, error, onStart }: { looking: boolean; error: string | null; onStart: () => void }) {
  const kit = useKit();
  if (!kit) return null;
  const { scan, nfc, native } = kit;
  const unsupported = nfc?.support === "none";
  const shown = error ?? scan.error;
  return (
    <div className="kit-scan-prompt">
      <NfcNotice nfc={nfc} native={native} />
      {!unsupported && (
        <div className={`kit-scan-target${scan.active ? " is-active" : ""}`} role="status" aria-live="polite">
          {looking ? (
            <Loader2 size={22} className="roster-spinner" aria-hidden="true" />
          ) : (
            <Nfc size={22} aria-hidden="true" />
          )}
          <span>
            {looking ? "Looking up the tag…" : scan.active ? "Hold the top of the phone near the kit tag" : "Not scanning"}
          </span>
          {!scan.active && !looking && (
            <button type="button" className="kit-btn primary" onClick={onStart}>
              Scan a tag
            </button>
          )}
        </div>
      )}
      {shown && (
        <p className="kit-scan-error" role="alert">
          {shown}
        </p>
      )}
    </div>
  );
}

/** Find an item by asset code, label or type: the fallback when a tag won't scan. */
export function ItemSearch({
  onPick,
  filter,
  placeholder = "Asset code, e.g. TENT-03",
}: {
  onPick: (item: ItemSummary) => void;
  filter?: (item: ItemSummary) => boolean;
  placeholder?: string;
}) {
  const kit = useKit();
  const [query, setQuery] = useState("");
  if (!kit) return null;
  const pool = filter ? kit.items.filter(filter) : kit.items;
  const matches = matchItems(pool, query);
  return (
    <div className="kit-scan-search">
      <p className="event-section-title">Or find it</p>
      <label className="roster-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          inputMode="search"
          autoComplete="off"
          autoCapitalize="characters"
          placeholder={placeholder}
          aria-label="Find a tagged item"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
            <X size={15} />
          </button>
        )}
      </label>
      {query.trim() &&
        (matches.length ? (
          <ul className="kit-list kit-scan-results">
            {matches.map((item) => (
              <li key={item.id} className="kit-item">
                <button type="button" className="kit-item-main" onClick={() => onPick(item)}>
                  <span className="kit-item-name">
                    <span className="kit-asset">{item.asset_code}</span>
                    {item.label ? ` · ${item.label}` : ""}
                  </span>
                  <span className="kit-item-meta">{item.equipment_name}</span>
                </button>
                <span className={`kit-tag is-${item.status}`}>{STATUS_LABELS[item.status]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="kit-scan-none">
            {kit.items.length ? "No tagged item matches." : kit.itemsLoaded ? "No kit has been tagged yet." : "Loading tagged kit…"}
          </p>
        ))}
    </div>
  );
}
