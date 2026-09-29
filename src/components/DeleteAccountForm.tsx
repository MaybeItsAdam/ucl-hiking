"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deletionBlockMessage, describeItem, dueLine, type DeletionBlock } from "@/lib/kitLoans";

function isDeletionBlock(value: unknown): value is DeletionBlock {
  if (!value || typeof value !== "object") return false;
  const v = value as { reason?: unknown; items?: unknown };
  return (v.reason === "on_loan" || v.reason === "cooling_off") && Array.isArray(v.items);
}

function BlockNotice({ block, today }: { block: DeletionBlock; today: string }) {
  const { title, detail } = deletionBlockMessage(block);
  return (
    <div className="delete-account-block" role="alert">
      <p className="delete-account-block-title">{title}</p>
      {block.items.length ? (
        <ul className="delete-account-block-items">
          {block.items.map((item) => {
            const due = "endDate" in item ? dueLine(item.endDate, today) : null;
            return (
              <li key={item.id}>
                {describeItem(item)}
                {due ? <span className="delete-account-block-due"> · {due}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <p>{detail}</p>
      {block.reason === "on_loan" ? <Link href="/portal/equipment">See your kit</Link> : null}
    </div>
  );
}

/**
 * `initialBlock` is the account page's own check, so the member is told up front;
 * the server checks again when they press delete.
 */
export function DeleteAccountForm({ initialBlock = null, today = "" }: { initialBlock?: DeletionBlock | null; today?: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [block, setBlock] = useState<DeletionBlock | null>(initialBlock);

  async function deleteAccount() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "delete" }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string; block?: unknown } | null;
      if (!response.ok) {
        if (isDeletionBlock(result?.block)) {
          setBlock(result.block);
          setConfirming(false);
        } else {
          setError(result?.error ?? "Could not delete your account. Try again.");
        }
        setPending(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setPending(false);
    }
  }

  if (block) {
    return (
      <div className="delete-account">
        <BlockNotice block={block} today={today} />
      </div>
    );
  }

  return (
    <div className="delete-account">
      {error ? <p className="delete-account-error" role="alert">{error}</p> : null}
      {confirming ? (
        <>
          <p className="delete-account-warning">This can&apos;t be undone. Delete your account?</p>
          <div className="delete-account-actions">
            <button type="button" className="delete-account-danger" onClick={deleteAccount} disabled={pending}>
              {pending ? "Deleting…" : "Yes, delete my account"}
            </button>
            <button type="button" className="delete-account-cancel" onClick={() => setConfirming(false)} disabled={pending}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="delete-account-danger" onClick={() => setConfirming(true)}>
          Delete my account
        </button>
      )}
    </div>
  );
}
