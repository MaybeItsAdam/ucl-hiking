"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Send } from "lucide-react";
import { OpenExternal } from "@/components/OpenExternal";
import { asksWhatWasBought, CLAIM_CATEGORIES, CLAIM_FORMS, CLAIM_KIND_LABELS, claimProblem, type ClaimFields } from "@/lib/expenseClaims";
import type { ClaimKind } from "@/lib/reimbursementToken";

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "application/pdf"];

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

const blank = (): ClaimFields => ({
  event: "",
  date: today(),
  category: "",
  description: "",
  amount: "",
  accountName: "",
  sortCode: "",
  accountNumber: "",
});

/** A phone photo shrunk to a readable JPEG, so it travels well over a walk's mobile signal. */
async function shrinkPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.size < 1_500_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error("The receipt couldn't be read."));
    reader.readAsDataURL(blob);
  });
}

/**
 * The claim goes from this page straight to the treasurer's spreadsheet (an
 * Apps Script on it). The app's server only hands out a ten-minute token saying
 * who is claiming; it never sees the amount, the receipt or the bank details,
 * and nothing is kept in the browser either.
 */
export function ExpenseClaimForm({ kinds, name, email }: { kinds: ClaimKind[]; name: string; email: string }) {
  const [kind, setKind] = useState<ClaimKind>(kinds[0]);
  const [fields, setFields] = useState<ClaimFields>(blank);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const set = (key: keyof ClaimFields) => (e: { target: { value: string } }) => {
    setFields((f) => ({ ...f, [key]: e.target.value }));
    setMessage(null);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = claimProblem(fields, kind);
    if (problem) {
      setMessage({ ok: false, text: problem });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      let receiptBody: { name: string; type: string; data: string } | null = null;
      if (receipt) {
        const blob = await shrinkPhoto(receipt);
        if (blob.size > MAX_RECEIPT_BYTES) throw new Error("The receipt is over 5 MB. Take a smaller photo.");
        const type = blob.type || receipt.type;
        if (!RECEIPT_TYPES.includes(type)) throw new Error("The receipt should be a photo or a PDF.");
        const baseName = receipt.name.replace(/\.[^.]+$/, "") || "receipt";
        receiptBody = { name: blob === receipt ? receipt.name : `${baseName}.jpg`, type, data: await base64Of(blob) };
      }

      const tokenRes = await fetch(`/api/reimbursements/token?kind=${kind}`, { cache: "no-store" });
      const pass = (await tokenRes.json().catch(() => ({}))) as { token?: string; endpoint?: string; error?: string };
      if (!tokenRes.ok || !pass.token || !pass.endpoint) throw new Error(pass.error ?? "The claim form isn't available right now.");

      const claim = {
        ...fields,
        description: asksWhatWasBought(kind) ? fields.description : "",
        amount: fields.amount.replace(/[£,\s]/g, ""),
        sortCode: fields.sortCode.replace(/[\s-]/g, ""),
        accountNumber: fields.accountNumber.replace(/\s/g, ""),
      };
      // text/plain keeps this a "simple" request: Apps Script can't answer a CORS preflight.
      const res = await fetch(pass.endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ token: pass.token, claim, receipt: receiptBody }),
        redirect: "follow",
        credentials: "omit",
        cache: "no-store",
      });
      const result = (await res.json().catch(() => null)) as { ok?: boolean; ref?: string; error?: string } | null;
      if (!result) throw new Error("The treasurer's spreadsheet didn't answer. Nothing was sent; try again, or use the Google Form.");
      if (!result.ok) throw new Error(result.error ?? "The spreadsheet turned the claim down.");

      setFields(blank());
      setReceipt(null);
      if (fileInput.current) fileInput.current.value = "";
      setMessage({ ok: true, text: `Sent to the treasurer. Your reference is ${result.ref}.` });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error && err.message !== "Failed to fetch" ? err.message : "It couldn't be sent. Check your signal and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="kit-form club-form expense-form" onSubmit={submit} autoComplete="off">
      <p className="expense-who">
        <span className="event-eyebrow">Claiming as</span>
        {name || email}
        {name ? <span className="expense-email"> · {email}</span> : null}
      </p>

      {kinds.length > 1 ? (
        <Field label="Claim type">
          <select value={kind} onChange={(e) => setKind(e.target.value as ClaimKind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {CLAIM_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <div className="kit-form-row is-wide-first">
        <Field label="Walk or event">
          <input value={fields.event} onChange={set("event")} maxLength={200} placeholder="Seven Sisters #2" />
        </Field>
        <Field label="Date paid">
          <input type="date" value={fields.date} onChange={set("date")} max={today()} required />
        </Field>
      </div>

      <div className="kit-form-row is-wide-first">
        <Field label="What for">
          <select value={fields.category} onChange={set("category")} required>
            <option value="" disabled>
              Choose…
            </option>
            {CLAIM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount (£)">
          <input value={fields.amount} onChange={set("amount")} inputMode="decimal" placeholder="31.65" maxLength={10} required />
        </Field>
      </div>

      {asksWhatWasBought(kind) ? (
        <Field label="What you bought">
          <textarea rows={2} value={fields.description} onChange={set("description")} maxLength={500} required placeholder="Train ticket to Seaford for the first-aid kit run" />
        </Field>
      ) : null}

      <Field label="Receipt" hint="A photo or PDF, up to 5 MB.">
        <input
          ref={fileInput}
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => {
            setReceipt(e.target.files?.[0] ?? null);
            setMessage(null);
          }}
        />
      </Field>

      <fieldset className="expense-bank">
        <legend className="event-eyebrow">Pay it into</legend>
        <Field label="Name on the account">
          <input value={fields.accountName} onChange={set("accountName")} maxLength={70} required autoComplete="off" />
        </Field>
        <div className="kit-form-row">
          <Field label="Sort code">
            <input value={fields.sortCode} onChange={set("sortCode")} inputMode="numeric" placeholder="00-00-00" maxLength={8} required autoComplete="off" />
          </Field>
          <Field label="Account number">
            <input value={fields.accountNumber} onChange={set("accountNumber")} inputMode="numeric" placeholder="8 digits" maxLength={9} required autoComplete="off" />
          </Field>
        </div>
      </fieldset>

      <p className="day-note">
        This goes straight to the treasurer&apos;s reimbursement spreadsheet. The hiking app checks it&apos;s you, but never sees or
        keeps your bank details, the amount or the receipt.
      </p>
      {message ? (
        <p className={message.ok ? "club-ok" : "kit-form-error"} role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      ) : null}
      <div className="calendar-feed-actions">
        <button type="submit" className="kit-btn primary" disabled={busy}>
          <Send size={15} aria-hidden="true" />
          {busy ? "Sending…" : "Send to the treasurer"}
        </button>
        <OpenExternal className="kit-btn" href={CLAIM_FORMS[kind]}>
          Use the Google Form instead
        </OpenExternal>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="kit-field">
      <span>{label}</span>
      {children}
      {hint ? <small className="kit-field-hint">{hint}</small> : null}
    </label>
  );
}
