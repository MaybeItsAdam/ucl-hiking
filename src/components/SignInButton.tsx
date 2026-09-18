import Link from "next/link";
import { LogIn } from "lucide-react";

// Always goes through /auth/signin, in the app as well as on the web: that page
// opens UCL sign-in (in the system browser on a phone) and also holds the
// hidden store-reviewer form, which reviewers could never reach if this button
// jumped straight to UCL.
export function SignInButton({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={compact ? "sign-in compact" : "sign-in"} href="/auth/signin">
      <LogIn size={16} aria-hidden="true" />
      <span>{compact ? "UCL sign in" : "Sign in with UCL"}</span>
    </Link>
  );
}
