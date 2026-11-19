import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { CalendarNameLink } from "@/components/CalendarNameLink";
import { longDate } from "@/lib/eventList";
import type { Member } from "@/lib/types";
import { outstandingClaims, type WalkClaimStatus } from "@/lib/walkClaims";
import { walkClaimsFor } from "@/lib/walkClaimsData";
import styles from "./WalkClaims.module.css";

const plural = (n: number) => `${n} ${n === 1 ? "walk" : "walks"}`;

/**
 * My walks, for walk leaders: the walks they led or backmarked lately that
 * still need a reimbursement claim, first and with a Claim button, then the
 * ones already claimed. Always says something: when the spreadsheet can't be
 * read the walks are listed without a status, and when the calendar can't be
 * matched to them it asks which name is theirs, instead of the section
 * silently going missing.
 */
export async function WalkClaims({ member }: { member: Member }) {
  const view = await walkClaimsFor(member).catch(() => null);
  if (!view) return null;
  const { walks, claimsKnown, linked, calendarName, unlinkedNames } = view;
  const open = outstandingClaims(walks);
  const claimed = walks.filter((w) => w.claimed === true);

  // Not tied to the roster: the walks below are a guess from their name, so ask.
  const askName = !linked && unlinkedNames?.length ? (
    <div className={styles.callout}>
      <p className={styles.label}>Which one is you?</p>
      <p className="event-meta">
        {walks.length
          ? "These are matched to you by name. Pick your name on the WL calendar so every walk you lead is found."
          : "We couldn't find you on the WL calendar. Pick the name you lead under to see the walks you've led and which still need a claim."}
      </p>
      <CalendarNameLink names={unlinkedNames} guess={calendarName} />
    </div>
  ) : !linked && !walks.length ? (
    // Nothing to pick from: every roster name is linked, or the roster didn't load.
    <p className={`event-meta ${styles.summary}`}>
      We couldn&apos;t find you on the WL calendar, so the walks you&apos;ve led can&apos;t be listed. Ask a principal
      to put your sign-in email ({member.email}) on your row of the WL roster.
    </p>
  ) : null;

  return (
    <section aria-labelledby="walk-claims-title" className={styles.section}>
      <h2 id="walk-claims-title" className="events-month">
        Reimbursements
      </h2>

      {!claimsKnown ? (
        <>
          <p className={`event-meta ${styles.summary}`}>
            The reimbursement spreadsheet didn&apos;t answer, so we can&apos;t tell which of these you&apos;ve claimed
            for. Try again in a minute.
          </p>
          {askName}
          {walks.length ? <ClaimList walks={walks} /> : null}
        </>
      ) : (
        <>
          {open.length ? (
            <p className={`${styles.callout} ${styles.due}`} role="status">
              <strong>{plural(open.length)} still to claim for.</strong> Claim each one after you&apos;ve filled in
              the route feedback form.
            </p>
          ) : walks.length ? (
            <p className={`event-meta ${styles.summary}`}>
              You&apos;ve claimed for every walk you led in the last three months.
            </p>
          ) : linked ? (
            <p className={`event-meta ${styles.summary}`}>No walks led in the last three months.</p>
          ) : null}
          {askName}
          {open.length ? <ClaimList walks={open} /> : null}
          {claimed.length ? (
            <details className={styles.claimed}>
              <summary className={styles.label}>Claimed · {claimed.length}</summary>
              <ClaimList walks={claimed} />
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

function ClaimList({ walks }: { walks: WalkClaimStatus[] }) {
  return (
    <ol className="events-list">
      {walks.map((walk) => (
        <li key={walk.key} className={styles.row}>
          <div className={styles.body}>
            <h3>{walk.eventId ? <Link href={`/portal/events/${walk.eventId}`}>{walk.title}</Link> : walk.title}</h3>
            <p className="event-meta">{longDate(`${walk.date}T12:00:00Z`)}</p>
          </div>
          <div className={styles.side}>
            {walk.claimed === true ? (
              <span className={styles.tag}>Claimed</span>
            ) : (
              <>
                {walk.claimed === false ? <span className={`${styles.tag} ${styles.open}`}>Not claimed</span> : null}
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
  );
}

/**
 * What a walk leader sees while the spreadsheet is read: the section's heading
 * and a few rows in its shape, so the list doesn't pop in under a page that
 * looked finished. Only rendered for leaders, who are the ones that get it.
 */
export function WalkClaimsSkeleton() {
  return (
    <section aria-labelledby="walk-claims-title" aria-busy="true" className={styles.section}>
      <h2 id="walk-claims-title" className="events-month">
        Reimbursements
      </h2>
      <p className="sr-only" role="status">Loading your reimbursements…</p>
      <span className={`skeleton ${styles.summarySkeleton}`} aria-hidden="true" />
      <ul className="skeleton-list" aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <li key={i}>
            <span className="skeleton-lines">
              <span className="skeleton" />
              <span className="skeleton" />
            </span>
            <span className="skeleton skeleton-trailing" />
          </li>
        ))}
      </ul>
    </section>
  );
}
