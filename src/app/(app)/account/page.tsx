import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountButton } from "@/components/AccountButton";
import { CalendarFeed } from "@/components/CalendarFeed";
import { DeleteAccountForm } from "@/components/DeleteAccountForm";
import { NotificationPrefs } from "@/components/NotificationPrefs";
import { SafetyDetailsForm } from "@/components/SafetyDetailsForm";
import { ThemeSetting } from "@/components/ThemeSetting";
import { GOVERNANCE_LABELS, MEMBERSHIP_LABELS } from "@/lib/access";
import { getCurrentMember, getRealMember, getRolePreviewState, getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Account settings | UCL Hiking Club",
};

export default async function AccountPage() {
  // The session, not getCurrentMember(): an expired member must still be able to get
  // here to delete their account, and role preview must not change what is shown.
  const session = await getSession();
  if (!session) redirect("/auth/signin");
  const member = await getRealMember();
  const previewState = await getRolePreviewState();

  const name = member?.full_name || session.name;
  const membership = member
    ? MEMBERSHIP_LABELS[member.membership_tier]
    : "Not current";
  const role = member?.governance_role ? GOVERNANCE_LABELS[member.governance_role] : null;

  return (
    <article className="account-settings">

      <section aria-labelledby="account-details">
        <h2 id="account-details">Your account</h2>
        <dl className="account-details">
          {name ? (<><dt>Name</dt><dd>{name}</dd></>) : null}
          <dt>Email</dt><dd>{session.email}</dd>
          <dt>Membership</dt><dd>{membership}</dd>
          {role ? (<><dt>Role</dt><dd>{role}</dd></>) : null}
        </dl>
        <p className="account-note">
          Your name and email come from your UCL sign-in, and your membership from the
          club&apos;s Students&apos; Union records.
        </p>
      </section>

      {previewState.isRealAdmin && (
        // Phones only: on wider screens the same menu sits in the top bar.
        <section aria-labelledby="admin-preview" className="settings-admin">
          <h2 id="admin-preview">Admin</h2>
          <AccountButton
            member={await getCurrentMember()}
            isRealAdmin
            preview={previewState.preview}
            realMember={previewState.realMember}
          />
          <p className="account-note">See the app as another kind of member.</p>
        </section>
      )}

      {member ? (
        <section aria-labelledby="notifications-title" id="notifications">
          <h2 id="notifications-title">Notifications</h2>
          <NotificationPrefs />
          <p className="account-note">
            Everything arrives in your inbox (the bell). In the phone app it&apos;s also sent as a notification, if
            you allow them.
          </p>
        </section>
      ) : null}

      {member ? (
        <section aria-labelledby="safety">
          <h2 id="safety">Emergency details</h2>
          <p className="account-note">
            Optional. If you add them, only the leader and backmarker of a walk you&apos;re on can see them, from
            the day before the walk until the day after, and every look is logged. They&apos;re stored encrypted.
            Delete them here at any time. See the <Link href="/privacy#safety">privacy policy</Link>.
          </p>
          <SafetyDetailsForm />
        </section>
      ) : null}

      {member ? (
        <section aria-labelledby="calendar">
          <h2 id="calendar">Calendar</h2>
          <CalendarFeed />
          <p className="account-note">
            Every club event, kept up to date in Google Calendar, Apple Calendar or Outlook.
            The link is private to you; reset it if you shared it by mistake.
          </p>
        </section>
      ) : null}

      <section aria-labelledby="appearance">
        <h2 id="appearance">Appearance</h2>
        <ThemeSetting />
        <p className="account-note">System follows your phone or computer&apos;s light or dark setting.</p>
      </section>

      <section aria-labelledby="privacy">
        <h2 id="privacy">Privacy</h2>
        <p>
          Read the <Link href="/privacy">privacy policy</Link> to see what the app keeps
          and why.
        </p>
        <form action="/api/auth/logout" method="post">
          <button type="submit" className="delete-account-cancel">Sign out</button>
        </form>
      </section>

      <section aria-labelledby="delete-account" className="account-danger">
        <h2 id="delete-account">Delete your account</h2>
        <p>Deleting your hiking app account removes, straight away:</p>
        <ul>
          <li>your name, email and membership details held by the hiking app</li>
          <li>your equipment requests</li>
          <li>your emergency details and walk attendance</li>
        </ul>
        <p>
          It does not delete your UCL account, your Adam&apos;s Campus Toolbox sign-in or
          your Students&apos; Union membership. A record that an account was deleted is
          kept, without your name or email. If you are still a club member and sign in
          again, a new, empty account is created. If you have club kit out on loan,
          return it to the committee first.
        </p>
        <DeleteAccountForm />
      </section>
    </article>
  );
}
