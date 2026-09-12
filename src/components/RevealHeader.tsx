"use client";

import { useEffect, useState, type ReactNode } from "react";

export function RevealHeader({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    function handleScroll() {
      // Reveal the top bar only after the introductory landing page
      setRevealed(window.scrollY > 280);
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className={`revealing-header-wrapper ${revealed ? "is-revealed" : ""}`}>
      {children}
    </div>
  );
}
