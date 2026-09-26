"use client";

import { useSyncExternalStore } from "react";
import { Check } from "lucide-react";

// Same-tab changes don't fire "storage", so toggle() notifies subscribers itself.
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function read(storageKey: string): string {
  try {
    return localStorage.getItem(storageKey) ?? "[]";
  } catch {
    return "[]";
  }
}

/**
 * The leader's kit list as a packing checklist. Ticks are the member's own and
 * stay on their device; nothing is sent anywhere.
 */
export function KitChecklist({ eventKey, items }: { eventKey: string; items: string[] }) {
  const storageKey = `hiking:kit:${eventKey}`;
  // A string snapshot, so React can compare it; parsed below.
  const raw = useSyncExternalStore(subscribe, () => read(storageKey), () => "[]");
  let ticked: Set<string>;
  try {
    ticked = new Set(JSON.parse(raw) as string[]);
  } catch {
    ticked = new Set();
  }

  function toggle(item: string) {
    const next = new Set(ticked);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      // Private mode: ticks just don't persist.
    }
    listeners.forEach((listener) => listener());
  }

  const packed = items.filter((item) => ticked.has(item)).length;

  return (
    <div className="kit-checklist">
      <p className="kit-checklist-count">
        {packed === items.length ? "All packed" : `${packed} of ${items.length} packed`}
      </p>
      <ul>
        {items.map((item) => {
          const on = ticked.has(item);
          return (
            <li key={item}>
              <button type="button" className={on ? "is-on" : undefined} aria-pressed={on} onClick={() => toggle(item)}>
                <span className="kit-checklist-box" aria-hidden="true">
                  {on ? <Check size={14} /> : null}
                </span>
                {item}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
