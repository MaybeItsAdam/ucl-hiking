import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";

/**
 * The signed-in tabs share one frame. Living in a layout, it is rendered once
 * and kept while the tabs change beneath it, so a tap only waits on the page
 * that changed — and the tab bar, title and gestures never blink out between.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
