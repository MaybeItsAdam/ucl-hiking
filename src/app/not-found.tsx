import Link from "next/link";
import { Header } from "@/components/Header";
import { Compass, ArrowRight } from "lucide-react";

export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", background: "var(--paper)" }}>
      <Header />
      <div
        style={{
          maxWidth: 600,
          margin: "80px auto",
          padding: "48px 32px",
          textAlign: "center",
          background: "#ffffff",
          borderRadius: 24,
          border: "2px solid var(--ink)",
          boxShadow: "0 12px 32px rgba(47,67,85,.08)",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "var(--cream)",
            display: "grid",
            placeItems: "center",
            margin: "0 auto 20px",
            color: "var(--forest)",
          }}
        >
          <Compass size={28} />
        </div>
        <span
          style={{
            display: "inline-block",
            fontSize: 11,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: ".1em",
            color: "var(--peach)",
            marginBottom: 8,
          }}
        >
          Trail Marker Not Found
        </span>
        <h1 style={{ font: "800 32px var(--font-display)", margin: "0 0 12px", color: "var(--ink)" }}>
          Off the beaten track
        </h1>
        <p style={{ margin: "0 0 28px", fontSize: 14, opacity: 0.7, lineHeight: 1.6 }}>
          We couldn&apos;t find the path you were looking for. Head back to basecamp or explore upcoming walks on the trail.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/" className="button">
            Home
          </Link>
          <Link href="/portal" className="button primary">
            Member Basecamp <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </main>
  );
}
