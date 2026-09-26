"use client";

import { useState } from "react";
import { CalendarSync, Copy, RotateCcw } from "lucide-react";

interface Feed {
  url: string;
  webcal: string;
}

/**
 * The member's private calendar feed. The link is fetched on demand, not
 * rendered into the page, because anyone holding it can read the club diary.
 */
export function CalendarFeed() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function call(method: "GET" | "POST") {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/account/calendar", { method });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "The calendar link didn't load.");
      setFeed(body);
      if (method === "POST") setMessage("New link made. The old one has stopped working.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "The calendar link didn't load.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feed.url);
      setMessage("Link copied. Paste it into your calendar app's “Add by URL”.");
    } catch {
      setMessage("Couldn't copy. Press and hold the link to copy it.");
    }
  }

  if (!feed) {
    return (
      <div className="calendar-feed">
        <button type="button" className="kit-btn" onClick={() => call("GET")} disabled={busy}>
          <CalendarSync size={15} aria-hidden="true" />
          {busy ? "Getting link…" : "Subscribe to club events"}
        </button>
        {message ? <p className="account-note">{message}</p> : null}
      </div>
    );
  }

  return (
    <div className="calendar-feed">
      <code className="calendar-feed-url">{feed.url}</code>
      <div className="calendar-feed-actions">
        <a className="kit-btn primary" href={feed.webcal}>
          <CalendarSync size={15} aria-hidden="true" />
          Open in calendar
        </a>
        <button type="button" className="kit-btn" onClick={copy}>
          <Copy size={15} aria-hidden="true" />
          Copy link
        </button>
        <button type="button" className="kit-btn danger-text" onClick={() => call("POST")} disabled={busy}>
          <RotateCcw size={15} aria-hidden="true" />
          Reset link
        </button>
      </div>
      {message ? <p className="account-note">{message}</p> : null}
    </div>
  );
}
