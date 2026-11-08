"use client";

import { useState, type FormEvent } from "react";
import { ITEM_CONDITIONS, type ItemCondition, type ItemSummary } from "@/lib/equipmentItems";
import { MAX_RESOLUTION_NOTE, SEVERITY_LABELS, suggestedCondition, type ConditionReport } from "@/lib/kitReports";
import { CONDITION_LABELS, formatWhen } from "./format";

/** What was reported: how bad, which item, who and when, and their words. */
export function ReportSummary({ report, showKit = true }: { report: ConditionReport; showKit?: boolean }) {
  const kit = report.item ? `${report.equipment_name} · ${report.item.asset_code}` : report.equipment_name;
  const who = report.reporter ?? "A member";
  return (
    <div className="kit-report-body">
      <div className="kit-request-head">
        <strong>{showKit ? kit : who}</strong>
        <span className={`kit-tag is-${report.severity}`}>{SEVERITY_LABELS[report.severity]}</span>
      </div>
      <p className="kit-request-meta">
        {showKit ? `${who} · ` : ""}
        {formatWhen(report.created_at)}
      </p>
      <p className="kit-report-text">{report.description}</p>
    </div>
  );
}

/**
 * Resolve a report, with an optional note. If it names a tagged item, the
 * lender can re-grade the item at the same time (recorded as a flag on it).
 */
export function ResolveReportForm({
  report,
  onCancel,
  onResolved,
}: {
  report: ConditionReport;
  onCancel: () => void;
  onResolved: (item: ItemSummary | undefined) => void;
}) {
  const [note, setNote] = useState("");
  const [condition, setCondition] = useState<ItemCondition | "">(report.item_id ? suggestedCondition(report.severity) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/equipment/reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined, condition: condition || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; item?: ItemSummary };
      if (!res.ok) {
        setError(data.error || "Couldn't resolve the report. Try again.");
        return;
      }
      onResolved(data.item);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="kit-form kit-card-panel" onSubmit={submit}>
      {report.item_id && (
        <label className="kit-field">
          <span>Set {report.item?.asset_code ?? "the item"} to</span>
          <select value={condition} onChange={(e) => setCondition(e.target.value as ItemCondition | "")}>
            <option value="">Leave its condition as it is</option>
            {ITEM_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="kit-field">
        <span>What was done (optional)</span>
        <input
          type="text"
          maxLength={MAX_RESOLUTION_NOTE}
          placeholder="e.g. New pole section fitted"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {error && (
        <p className="kit-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="kit-card-submit">
        <button type="button" className="kit-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="kit-btn primary" disabled={busy}>
          {busy ? "Saving…" : "Resolve"}
        </button>
      </div>
    </form>
  );
}
