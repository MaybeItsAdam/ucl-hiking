import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { longDate } from "@/lib/eventList";
import type { Member } from "@/lib/types";
import { walkClaimStatuses } from "@/lib/walkClaimsData";
import styles from "./WalkClaims.module.css";

/**
 * My walks, for walk leaders: the walks they've led lately and whether the
 * reimbursement spreadsheet has their claim for each, from the Google Form
 * or the app. Shows nothing when the spreadsheet can't be read, rather than
 * a list of walks wrongly marked unclaimed.
 */
export async function WalkClaims({ member }: { member: Member }) {
  const walks = await walkClaimStatuses(member).catch(() => null);
  if (!walks?.length) return null;
  const open = walks.filter((w) => !w.claimed);
  const ordered = [...open, ...walks.filter((w) => w.claimed)];

  return (
    <section aria-labelledby="walk-claims-title">
      <h2 id="walk-claims-title" className="events-month">
        Walks you led
      </h2>
      <p className={`event-meta ${styles.summary}`}>
        {open.length
          ? `${open.length} ${open.length === 1 ? "walk" : "walks"} still to claim for.`
          : "You've claimed for every walk you led in the last three months."}
      </p>
      <ol className="events-list">
        {ordered.map((walk) => (
          <li key={walk.key} className={styles.row}>
            <div className={styles.body}>
              <h3>
                {walk.eventId ? <Link href={`/portal/events/${walk.eventId}`}>{walk.title}</Link> : walk.title}
              </h3>
              <p className="event-meta">{longDate(`${walk.date}T12:00:00Z`)}</p>
            </div>
            <div className={styles.side}>
              {walk.claimed ? (
                <span className={styles.tag}>Claimed</span>
              ) : (
                <>
                  <span className={`${styles.tag} ${styles.open}`}>Not claimed</span>
                  <Link href={`/portal/expenses?kind=wl&date=${walk.date}`} className={styles.claim}>
                    <ReceiptText size={15} aria-hidden="true" />
                    Claim<span className="sr-only"> for {walk.title}</span>
                  </Link>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
