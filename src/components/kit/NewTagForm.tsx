"use client";

import { useState, type FormEvent } from "react";
import { assetCodePrefix, nextAssetCode, normalizeAssetCode, type ItemSummary } from "@/lib/equipmentItems";
import { feedback } from "@/lib/nfc";
import { useKit } from "./KitLender";

/**
 * Tag a new item: an unknown tag was scanned, so say what kind of kit it is
 * on. The asset code is numbered for the type unless one is typed.
 */
export function NewTagForm({
  uid,
  offline,
  defaultLocation = "",
  onDone,
  onCancel,
}: {
  uid: string;
  offline?: boolean;
  defaultLocation?: string;
  /** The new item, or null when it was queued offline. */
  onDone: (item: ItemSummary | null) => void;
  onCancel: () => void;
}) {
  const kit = useKit();
  const [equipmentId, setEquipmentId] = useState("");
  const [label, setLabel] = useState("");
  const [location, setLocation] = useState(defaultLocation);
  const [assetCode, setAssetCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ItemSummary | null | undefined>(undefined);

  if (!kit) return null;
  const types = [...kit.equipment].sort((a, b) => a.name.localeCompare(b.name));
  const type = types.find((t) => t.id === equipmentId);
  const taggedOfType = kit.items.filter((i) => i.equipment_id === equipmentId).length;
  // What the server will most likely pick; it has the final say.
  const preview = type ? nextAssetCode(assetCodePrefix(type.name), kit.items.map((i) => i.asset_code)) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!kit || !equipmentId) return;
    const code = assetCode.trim();
    if (code && !normalizeAssetCode(code)) {
      setError("Asset codes are letters, numbers and dashes, like TENT-03.");
      return;
    }
    setBusy(true);
    setError(null);
    const outcome = await kit.commission(
      {
        tagUid: uid,
        equipmentId,
        assetCode: code || undefined,
        label: label.trim() || undefined,
        location: location.trim() || undefined,
      },
      `Tag new ${type?.name ?? "item"}${code ? ` as ${code.toUpperCase()}` : ""}`,
    );
    setBusy(false);
    if (outcome.kind === "error") {
      feedback("error");
      setError(outcome.error);
      return;
    }
    feedback("ok");
    setCreated(outcome.kind === "ok" ? (outcome.result.item ?? null) : null);
  }

  if (created !== undefined) {
    return (
      <div className="kit-card">
        <p className="event-section-title">Tagged</p>
        <h3 id="kit-sheet-title">
          {created ? <span className="kit-asset">{created.asset_code}</span> : "Saved on this phone"}
        </h3>
        <p className="kit-card-lede">
          {created
            ? `Write ${created.asset_code} on the item so it can be found without a phone.`
            : "No signal: it will be tagged when you're back online, and given its asset code then."}
        </p>
        <div className="modal-actions">
          <button type="button" className="kit-btn primary" onClick={() => onDone(created)}>
            {created ? "Open item" : "Done"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="kit-form" onSubmit={submit}>
      <div>
        <p className="event-section-title">New tag</p>
        <h3 id="kit-sheet-title" className="kit-asset">
          {uid}
        </h3>
        <p className="kit-card-lede">
          This tag isn&apos;t on any item yet. Say what it&apos;s stuck to.
          {offline ? " You're offline, so it will be saved when you're back online." : ""}
        </p>
      </div>
      <label className="kit-field">
        <span>Kit type</span>
        <select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)} required>
          <option value="" disabled>
            Choose the kind of kit
          </option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {type && (
          <span className="kit-field-hint">
            {taggedOfType} of {type.total_quantity} tagged so far.
          </span>
        )}
      </label>
      <label className="kit-field">
        <span>Asset code</span>
        <input
          type="text"
          autoCapitalize="characters"
          autoComplete="off"
          placeholder={preview ? `Leave blank for ${preview}` : "Leave blank to number it"}
          value={assetCode}
          onChange={(e) => setAssetCode(e.target.value)}
        />
      </label>
      <div className="kit-form-row">
        <label className="kit-field">
          <span>Label (optional)</span>
          <input type="text" placeholder="e.g. Blue Vango" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="kit-field">
          <span>Location (optional)</span>
          <input type="text" placeholder="e.g. Shelf B" value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
      </div>
      {error && (
        <p className="kit-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="kit-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="kit-btn primary" disabled={busy || !equipmentId}>
          {busy ? "Tagging…" : "Tag item"}
        </button>
      </div>
    </form>
  );
}
