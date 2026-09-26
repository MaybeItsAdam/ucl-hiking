"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { useAppRefresh } from "@/lib/refresh";

// One unread count shared by every bell on the page (top bar and phone title).
let unread = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setUnread(next: number) {
  unread = next;
  listeners.forEach((l) => l());
}

function refreshUnread() {
  inflight ??= fetch("/api/notifications?count=1", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : { unread: 0 }))
    .then((body: { unread?: number }) => setUnread(body.unread ?? 0))
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function InboxBell({ className }: { className?: string }) {
  const count = useSyncExternalStore(subscribe, () => unread, () => 0);
  const pathname = usePathname();

  useEffect(() => {
    void refreshUnread();
  }, [pathname]);
  useAppRefresh(() => void refreshUnread());

  return (
    <Link
      href="/portal/inbox"
      className={`inbox-bell${className ? ` ${className}` : ""}`}
      aria-label={count ? `Inbox, ${count} unread` : "Inbox"}
    >
      <Bell size={20} aria-hidden="true" />
      {count ? <span className="inbox-dot" aria-hidden="true" /> : null}
    </Link>
  );
}
