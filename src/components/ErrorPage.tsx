"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useOffline } from "next/offline";
import { CloudOff, TriangleAlert } from "lucide-react";
import { DeadEnd } from "@/components/DeadEnd";

/** The error boundary's page (app/error.tsx and the signed-in group's own). */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const offline = useOffline();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <DeadEnd
      icon={offline ? CloudOff : TriangleAlert}
      label={offline ? "No signal" : error.digest ? `Error · ${error.digest}` : "Error"}
      title={offline ? "This needs a connection" : "Something went wrong"}
      quip={offline ? "offline" : "error"}
    >
      <button type="button" className="button primary" onClick={() => retry()}>
        Try again
      </button>
      <Link href="/" className="button">
        Home
      </Link>
    </DeadEnd>
  );
}
