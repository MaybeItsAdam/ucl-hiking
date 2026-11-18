import type { ReactNode } from "react";
import { noIndex } from "@/lib/seo";

/** Sign-in steps: nothing here for a search result to land on. */
export const metadata = noIndex;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
