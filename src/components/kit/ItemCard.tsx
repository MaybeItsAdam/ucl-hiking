"use client";

import { useState, type FormEvent } from "react";
import { ITEM_CONDITIONS, itemName, type ItemCondition, type ItemSummary, type TagLookup } from "@/lib/equipmentItems";
import { handoverProgress, plural, requestsWithRoom, STATUS_LABELS } from "@/lib/kitScan";
import { feedback } from "@/lib/nfc";
import { useKit, type ItemView, type Outcome } from "./KitLender";
import { borrowerOf, CONDITION_LABELS, formatDays, formatWhen } from "./format";

type Panel = "check_in" | "handover" | "flag" | null;
type Note = { type: "ok" | "queued" | "error"; text: string };

const ACTION_WORDS: Record<string, string> = { check_in: "Check in", check_out: "Hand over", flag: "Flag", audit: "Audit" };

/**
 * One tagged item: what it is, where it is, who has it, and the actions that
 * make sense for its status.
 */
export function ItemCard({ view }: { view: ItemView }) {
  const kit = useKit();
  const [item, setItem] = useState<ItemSummary>(view.item);
  const [loanCounts, setLoanCounts] = useState<{ itemsOut: number; quantity: number } | null>(
    view.loan ? { itemsOut: view.loan.items_out, quantity: view.loan.quantity } : null,
  );
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [condition, setCondition] = useState<ItemCondition | "">("");
  const [text, setText] = useState("");
  const [requestId, setRequestId] = useState("");

  if (!kit) return null;
  const name = itemName(item);
  const loan: TagLookup["loan"] | ItemSummary["loan"] = view.loan && item.loan?.request_id === view.loan.request_id ? view.loan : item.loan;
  const loanRequest = loan ? kit.requests.find((r) => r.id === loan.request_id) : undefined;
  const borrower = loan?.borrower || (loanRequest ? borrowerOf(loanRequest) : null);
  const openRequests = requestsWithRoom(kit.requests, item.equipment_id);

  function open(next: Panel) {
    setPanel(panel === next ? null : next);
    setNote(null);
    setCondition(next === "flag" ? item.condition : "");
    setText("");
    setRequestId(next === "handover" && openRequests.length === 1 ? openRequests[0].id : "");
  }

  async function run(body: Parameters<NonNullable<typeof kit>["act"]>[1], done: string) {
    if (!kit) return;
    setBusy(true);
    const label = `${ACTION_WORDS[body.action]} ${item.asset_code}`;
    const outcome: Outcome = await kit.act(item.id, body, label);
    setBusy(false);
    if (outcome.kind === "error") {
      feedback("error");
      setNote({ type: "error", text: outcome.error });
      return;
    }
    feedback("ok");
    setPanel(null);
    if (outcome.kind === "queued") {
      setNote({ type: "queued", text: "No signal: saved on this phone, and sent when you're back online." });
      return;
    }
    const { result } = outcome;
    if (result.item) setItem(result.item);
    if (result.loan) {
      setLoanCounts(
        result.loan.allBack && body.action === "check_in" ? null : { itemsOut: result.loan.itemsOut, quantity: result.loan.quantity },
      );
    }
    let msg = result.noop ? result.message || "Nothing to change." : done;
    if (result.loan && body.action === "check_out") msg += ` ${handoverProgress(result.loan.quantity, result.loan.itemsOut).label}.`;
    if (result.loan && body.action === "check_in") {
      msg += result.loan.allBack
        ? " Every tagged item on that loan is back; mark the request returned when you're done."
        : ` ${plural(result.loan.itemsOut, "tagged item")} still out on that loan.`;
    }
    setNote({ type: "ok", text: msg });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (panel === "check_in") {
      void run({ action: "check_in", condition: condition || undefined, notes: text.trim() || undefined }, `${name} checked in.`);
    } else if (panel === "handover" && requestId) {
      const req = kit?.requests.find((r) => r.id === requestId);
      void run({ action: "check_out", requestId }, `${name} handed over${req ? ` to ${borrowerOf(req)}` : ""}.`);
    } else if (panel === "flag" && condition) {
      void run({ action: "flag", condition, notes: text.trim() || undefined }, `${name} marked ${CONDITION_LABELS[condition].toLowerCase()}.`);
    }
  }

  const canCheckIn = item.status === "on_loan" || item.status === "missing";
  const canHandOver = item.status === "available" || item.status === "missing";

  return (
    <div className="kit-card">
      <p className="event-section-title">{item.equipment_name}</p>
      <h3 id="kit-sheet-title">
        <span className="kit-asset">{item.asset_code}</span>
        {item.label ? <span className="kit-card-label">{item.label}</span> : null}
      </h3>
      {view.offline && (
        <p className="kit-card-offline" role="status">
          Offline: this is what the phone last saw. Changes are sent when you&apos;re back online.
        </p>
      )}

      <dl className="kit-facts">
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`kit-tag is-${item.status}`}>{STATUS_LABELS[item.status]}</span>
          </dd>
        </div>
        <div>
          <dt>Condition</dt>
          <dd>
            <span className={`kit-tag is-${item.condition}`}>{CONDITION_LABELS[item.condition]}</span>
          </dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{item.location || "Not set"}</dd>
        </div>
        <div>
          <dt>Last audited</dt>
          <dd>{formatWhen(item.last_audited_at)}</dd>
        </div>
        {loan && item.status === "on_loan" && (
          <div className="is-wide">
            <dt>On loan to</dt>
            <dd>
              {borrower ?? "A club member"} · {formatDays(loan.start_date, loan.end_date)}
              {loanCounts ? ` · ${loanCounts.itemsOut} of ${loanCounts.quantity} tagged items out` : ""}
            </dd>
          </div>
        )}
        {item.notes && (
          <div className="is-wide">
            <dt>Notes</dt>
            <dd>{item.notes}</dd>
          </div>
        )}
      </dl>

      <div className="kit-card-actions" role="group" aria-label="Actions">
        {canCheckIn && (
          <button type="button" className={`kit-btn${panel === "check_in" ? " is-open" : " primary"}`} disabled={busy} onClick={() => open("check_in")}>
            Check in
          </button>
        )}
        {canHandOver && (
          <button type="button" className={`kit-btn${panel === "handover" ? " is-open" : ""}`} disabled={busy} onClick={() => open("handover")}>
            Hand over
          </button>
        )}
        <button type="button" className={`kit-btn${panel === "flag" ? " is-open" : ""}`} disabled={busy} onClick={() => open("flag")}>
          Flag
        </button>
        <button
          type="button"
          className="kit-btn"
          disabled={busy}
          onClick={() => void run({ action: "audit" }, `${name} marked as audited.`)}
        >
          Mark audited
        </button>
      </div>

      {panel && (
        <form className="kit-form kit-card-panel" onSubmit={submit}>
          {panel === "check_in" && (
            <>
              <label className="kit-field">
                <span>Condition</span>
                <select value={condition} onChange={(e) => setCondition(e.target.value as ItemCondition | "")}>
                  <option value="">As before ({CONDITION_LABELS[item.condition].toLowerCase()})</option>
                  {ITEM_CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {CONDITION_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="kit-field">
                <span>Note (optional)</span>
                <input type="text" placeholder="e.g. Pole bag missing a peg" value={text} onChange={(e) => setText(e.target.value)} />
              </label>
            </>
          )}
          {panel === "handover" &&
            (openRequests.length ? (
              <label className="kit-field">
                <span>Hand over against</span>
                <select value={requestId} onChange={(e) => setRequestId(e.target.value)} required>
                  <option value="" disabled>
                    Choose an approved request
                  </option>
                  {openRequests.map((r) => (
                    <option key={r.id} value={r.id}>
                      {borrowerOf(r)} · {formatDays(r.start_date, r.end_date)} · {r.items?.length ?? 0} of {r.quantity} out
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="kit-card-empty">
                No approved request for {item.equipment_name.toLowerCase()} is waiting for kit. Approve one first.
              </p>
            ))}
          {panel === "flag" && (
            <>
              <label className="kit-field">
                <span>Condition</span>
                <select value={condition} onChange={(e) => setCondition(e.target.value as ItemCondition)} required>
                  {ITEM_CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {CONDITION_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="kit-field">
                <span>What&apos;s wrong (optional)</span>
                <input type="text" placeholder="e.g. Zip sticks on the inner door" value={text} onChange={(e) => setText(e.target.value)} />
              </label>
            </>
          )}
          {!(panel === "handover" && !openRequests.length) && (
            <div className="kit-card-submit">
              <button type="button" className="kit-btn" onClick={() => setPanel(null)}>
                Cancel
              </button>
              <button type="submit" className="kit-btn primary" disabled={busy || (panel === "handover" && !requestId)}>
                {busy ? "Saving…" : panel === "check_in" ? "Check in" : panel === "handover" ? "Hand over" : "Save"}
              </button>
            </div>
          )}
        </form>
      )}

      {note && (
        <p className={`kit-card-note is-${note.type}`} role={note.type === "error" ? "alert" : "status"}>
          {note.text}
        </p>
      )}
    </div>
  );
}
