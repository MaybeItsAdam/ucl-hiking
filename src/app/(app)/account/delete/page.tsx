import { redirect } from "next/navigation";

// Kept so older links to the deletion page still work.
export default function DeleteAccountPage() {
  redirect("/account#delete-account");
}
