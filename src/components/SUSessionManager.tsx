"use client";

import { useState } from "react";
import { Key, Save, CheckCircle2, ShieldAlert } from "lucide-react";

interface SUSessionManagerProps {
  currentStatus: string;
  onSaved: () => void;
}

export function SUSessionManager({ currentStatus, onSaved }: SUSessionManagerProps) {
  const [sessionId, setSessionId] = useState("");
  const [authState, setAuthState] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId.trim() && !authState.trim()) {
      setMsg({ type: "error", text: "Please enter a Session ID or Auth state string." });
      return;
    }

    setSubmitting(true);
    setMsg(null);

    try {
      const res = await fetch("/api/admin/suu-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId.trim(),
          authState: authState.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "error", text: data.error || "Failed to update SU session" });
      } else {
        setMsg({ type: "success", text: "SU session updated successfully. Status is now Active." });
        setSessionId("");
        setAuthState("");
        onSaved();
      }
    } catch {
      setMsg({ type: "error", text: "Network error updating session" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="su-session-card">
      <div className="su-session-header">
        <Key size={18} />
        <div>
          <h4>Update SU Portal Session (Principal Controls)</h4>
          <p>Update the Students&apos; Union session token (Current status: {currentStatus}).</p>
        </div>
      </div>

      {msg && (
        <div className={`alert-banner ${msg.type}`}>
          {msg.type === "success" ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}
          <span>{msg.text}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="su-session-form">
        <div className="form-group">
          <label htmlFor="sessionId">SU Session Cookie / Token</label>
          <input
            id="sessionId"
            type="text"
            placeholder="e.g. ASP.NET_SessionId cookie value or session token"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
          />
          <small className="form-hint">Obtain from browser developer tools after logging in to Students&apos; Union portal.</small>
        </div>

        <div className="form-group">
          <label htmlFor="authState">Playwright Auth Storage State (Optional)</label>
          <textarea
            id="authState"
            rows={3}
            placeholder="Optional: Paste base64 or JSON storage_state content"
            value={authState}
            onChange={(e) => setAuthState(e.target.value)}
          />
        </div>

        <button type="submit" disabled={submitting} className="button primary compact">
          <Save size={15} />
          {submitting ? "Saving..." : "Save SU Session"}
        </button>
      </form>
    </div>
  );
}
