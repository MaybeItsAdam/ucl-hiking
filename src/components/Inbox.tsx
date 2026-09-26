"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BellOff, CheckCheck } from "lucide-react";
import { setUnread } from "@/components/InboxBell";
import { NOTIFICATION_LABELS, type NotificationKind } from "@/lib/notify";
import { useAppRefresh } from "@/lib/refresh";

interface Item {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  url: string | null;
  read_at: string | null;
  created_at: string;
}

const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Inbox() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setItems(body.notifications);
      setUnread(body.unread ?? 0);
    } catch {
      setError("Your inbox didn't load.");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  useAppRefresh(() => void load());

  async function markRead(ids?: string[]) {
    const at = new Date().toISOString();
    setItems((list) => list?.map((i) => (!ids || ids.includes(i.id) ? { ...i, read_at: i.read_at ?? at } : i)) ?? null);
    const res = await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids ? { ids } : {}),
    }).catch(() => null);
    if (res?.ok) void load();
  }

  if (error) return <p className="day-error">{error}</p>;
  if (!items)
    return (
      <div className="skeleton-list">
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    );

  const unread = items.filter((i) => !i.read_at).length;

  return (
    <div className="inbox">
      {unread ? (
        <button type="button" className="kit-btn inbox-all" onClick={() => markRead()}>
          <CheckCheck size={15} aria-hidden="true" />
          Mark all read
        </button>
      ) : null}
      {items.length ? (
        <ul className="inbox-list">
          {items.map((item) => {
            const content = (
              <>
                <span className="event-eyebrow">
                  {NOTIFICATION_LABELS[item.kind]?.label ?? "Club"} · {when.format(new Date(item.created_at))}
                </span>
                <strong>{item.title}</strong>
                {item.body ? <span className="inbox-body">{item.body}</span> : null}
              </>
            );
            return (
              <li key={item.id} className={item.read_at ? undefined : "is-unread"}>
                {item.url?.startsWith("/") ? (
                  <Link href={item.url} onClick={() => !item.read_at && markRead([item.id])}>
                    {content}
                  </Link>
                ) : (
                  <button type="button" onClick={() => !item.read_at && markRead([item.id])}>
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="events-empty">
          <BellOff size={28} aria-hidden="true" />
          <p>Nothing yet. Walk changes, reminders and club news land here.</p>
        </div>
      )}
      <p className="day-note">
        Choose what you hear about in <Link href="/account#notifications">Settings</Link>.
      </p>
    </div>
  );
}
