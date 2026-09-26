"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { pounds, type FinanceLine } from "@/lib/finance";

/** A trip's extra income and costs: add a line, or delete one entered by mistake. */
export function MoneyLines({ eventSuuId, lines }: { eventSuuId: string; lines: FinanceLine[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(init: RequestInit, url = "/api/club/finance") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "That wasn't saved.");
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That wasn't saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (await call({ method: "POST", body: JSON.stringify({ event_suu_id: eventSuuId, kind, label, amount }) })) {
      setLabel("");
      setAmount("");
    }
  }

  return (
    <div className="money-lines">
      {lines.length ? (
        <ul>
          {lines.map((line) => (
            <li key={line.id}>
              <span>{line.label}</span>
              <strong className={line.kind === "expense" ? "is-out" : "is-in"}>
                {line.kind === "expense" ? "−" : "+"}
                {pounds(line.amount_pence)}
              </strong>
              <button
                type="button"
                className="kit-icon-btn"
                aria-label={`Delete ${line.label}`}
                disabled={busy}
                onClick={() => call({ method: "DELETE" }, `/api/club/finance?id=${line.id}`)}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="money-add" onSubmit={add}>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Income or expense">
          <option value="expense">Cost</option>
          <option value="income">Income</option>
        </select>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Coach" aria-label="What for" maxLength={120} />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="£0.00" inputMode="decimal" aria-label="Amount" />
        <button type="submit" className="kit-btn" disabled={busy || !label.trim() || !amount.trim()} aria-label="Add line">
          <Plus size={15} aria-hidden="true" />
        </button>
      </form>
      {error ? <p className="kit-form-error">{error}</p> : null}
    </div>
  );
}
