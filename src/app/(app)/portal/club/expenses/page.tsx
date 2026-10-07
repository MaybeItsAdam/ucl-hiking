import { redirect } from "next/navigation";

/** Claims moved to their own tab; old links still land there. */
export default function ClubExpensesPage() {
  redirect("/portal/expenses");
}
