"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY, type ThemeChoice } from "@/lib/theme";

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

// Same-tab changes don't fire "storage", so choose() notifies subscribers itself.
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

export function ThemeSetting() {
  // The server can't see localStorage, so it renders "system" and hydration then
  // switches to the saved choice without a mismatch.
  const choice = useSyncExternalStore(subscribe, readChoice, () => "system" as ThemeChoice);

  function choose(next: ThemeChoice) {
    const root = document.documentElement;
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice still applies until the app is closed.
    }
    listeners.forEach((listener) => listener());
  }

  return (
    <div className="theme-setting" role="radiogroup" aria-label="Appearance">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          className={choice === value ? "is-selected" : undefined}
          onClick={() => choose(value)}
        >
          <Icon size={16} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
