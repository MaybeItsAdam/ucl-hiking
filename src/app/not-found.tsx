import Link from "next/link";
import { Header } from "@/components/Header";
import { DeadEnd } from "@/components/DeadEnd";
import { Compass, ArrowRight } from "lucide-react";

export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", background: "var(--paper)" }}>
      <Header />
      <DeadEnd icon={Compass} label="Trail marker not found" title="Off the beaten track" quip="notFound">
        <Link href="/" className="button">
          Home
        </Link>
        <Link href="/portal" className="button primary">
          Member Basecamp <ArrowRight size={15} />
        </Link>
      </DeadEnd>
    </main>
  );
}
