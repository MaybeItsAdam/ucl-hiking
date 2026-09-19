"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteAccountForm() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "delete" }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(result?.error ?? "Could not delete your account. Try again.");
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
