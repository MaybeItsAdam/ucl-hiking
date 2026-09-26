import type { Metadata } from "next";
import Link from "next/link";
import { ClubMark } from "@/components/ClubMark";

export const metadata: Metadata = {
  title: "Privacy policy | UCL Hiking Club",
  description: "How MaybeItsSoftware handles information in the UCL Hiking Club website and app.",
};

const contactEmail = process.env.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL || "privacy@uclhiking.org";

export default function PrivacyPage() {
  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <Link href="/" className="privacy-brand" aria-label="UCL Hiking Club home">
          <ClubMark size={42} />
          <span>UCL Hiking Club</span>
        </Link>
        <Link href="/" className="privacy-back">Back to the hiking website</Link>
      </header>

      <article className="privacy-content">
        <p className="privacy-eyebrow">UCL Hiking Club website and mobile app</p>
        <h1>Privacy policy</h1>
        <p className="privacy-date">Last updated 26 September 2026</p>
        <p>
          MaybeItsSoftware owns and operates this UCL Hiking Club app and hiking website.
          This policy explains the personal information we handle when you visit the site,
          sign in, book a walk, or use the member and committee tools. It applies to this
          hiking service only. The Students&apos; Union, UCL and Adam&apos;s Campus Toolbox
          have their own privacy notices for the services they provide.
        </p>

        <h2>Information we use</h2>
        <ul>
          <li><strong>Identity and membership:</strong> your UCL account identifier, name and email from the Toolbox sign-in handoff; your club membership tier, expiry and role from the club and Students&apos; Union records; and your sign-in time.</li>
          <li><strong>Club activity:</strong> the walks you are on (from your Students&apos; Union ticket, or added by a leader), your check-in and return on the day, equipment requests and their dates, purpose and status, walk plans leaders write, and information you submit to leaders or committee tools.</li>
          <li><strong>Emergency details, only if you add them:</strong> your mobile number, an emergency contact&apos;s name, relationship and number, and any medical notes you choose to give. See <a href="#safety">Emergency details</a>.</li>
          <li><strong>Incident reports:</strong> if something happens on a walk, the leader&apos;s account of it, which may name you and describe an injury or illness.</li>
          <li><strong>Technical information:</strong> an essential sign-in cookie, request and error logs, and basic device/browser information needed to serve and protect the website and app.</li>
        </ul>
        <p>
          Walk locations shown in the app are event details. The app does not ask for your
          device&apos;s precise location. We do not use advertising trackers or sell your
          personal information.
        </p>

        <h2 id="safety">Emergency details</h2>
        <p>
          Adding emergency details is optional, and you can change or delete them at any time
          in <Link href="/account">Account settings</Link>. Medical notes are health
          information, a special category of personal data; we use them only with your
          explicit consent, which you give by entering them and withdraw by deleting them.
        </p>
        <ul>
          <li><strong>Who sees them:</strong> only the leader and the backmarker of a walk you are on, and only from 24 hours before the walk until 24 hours after it ends. Committee rank alone does not give access.</li>
          <li><strong>How they are protected:</strong> they are encrypted before they are stored, so the database and its backups hold only unreadable text. Every time a leader&apos;s register shows them, the view is recorded in the audit log.</li>
          <li><strong>On the leader&apos;s phone:</strong> so the register works without signal, the leader&apos;s phone keeps a copy of the day&apos;s register, including the details they may see, and deletes it 24 hours after the walk.</li>
          <li><strong>How long:</strong> until you delete them or your app account.</li>
        </ul>

        <h2>Why we use it</h2>
        <p>
          We use identity and membership information to authenticate you, check your
          current club access and show the appropriate member or committee tools. We use
          booking and kit information to run walks, waitlists and equipment lending.
          We use attendance and incident records to keep walks safe, to meet the
          Students&apos; Union&apos;s insurance and reporting expectations, and to see how the
          club programme is used. We use technical logs and audit records to keep the service working, resolve
          problems and prevent misuse. These activities are needed to provide the club
          service you request and for our legitimate interests in running it securely.
          Where a legal obligation applies, we may also need to keep or disclose records
          to meet that obligation.
        </p>

        <h2>Who receives information</h2>
        <p>
          Sign-in takes place through Adam&apos;s Campus Toolbox and UCL Single Sign-On.
          We receive a short-lived identity handoff and check club eligibility against
          Students&apos; Union or club membership records. We store app records in Supabase
          and use hosting and cloud services to deliver the site and run roster or event
          sync jobs. Authorised club leaders and committee members can see the member
          and booking details they need for their duties. Information may also be shared
          when required by law. Each provider may process information under its own
          terms and privacy notice.
        </p>

        <h2>Cookies, storage and security</h2>
        <p>
          After sign-in, the hiking service sets an essential, secure, HttpOnly session
          cookie that normally lasts up to seven days. Signing out clears it. Your UCL
          password is entered with UCL&apos;s sign-in service and is not stored by the
          hiking app. Access to app records is checked on the server against the current
          membership record; club data is not exposed directly through a browser
          database key. The app also keeps a few things on your device only: your theme,
          which kit you have ticked off for a walk, and, for leaders, the day&apos;s register
          for offline use.
        </p>

        <h2>How long information is kept</h2>
        <p>
          We keep membership and activity records for as long as needed to manage club
          access, bookings, kit requests and related accountability. Access is removed
          when a membership is revoked or expires, but previous records can remain
          until they are no longer needed for those purposes or a legal obligation.
          Technical logs are kept for the period needed for security and troubleshooting.
          You can ask us to delete information that is no longer required.
        </p>

        <h2 id="request-deletion">Delete your app account</h2>
        <p>
          In the app or on the website, sign in and open{" "}
          <Link href="/account">Account settings</Link> (from the member portal), then
          choose &ldquo;Delete my account&rdquo;. This immediately deletes
          your hiking app account, your equipment requests and your walk bookings. If you
          have club kit out on loan, return it first.
        </p>
        <p>
          If you can&apos;t sign in, email{" "}
          <a href={`mailto:${contactEmail}?subject=UCL%20Hiking%20app%20account%20deletion%20request`}>
            {contactEmail}
          </a>{" "}
          with the subject &ldquo;UCL Hiking app account deletion request&rdquo;. We may need
          to verify that the request comes from the account holder.
        </p>
        <p>
          Deleting the app account does not delete your UCL identity, your Adam&apos;s
          Campus Toolbox sign-in or your Students&apos; Union membership. We keep a record
          that an account was deleted, without your name or email, and security logs for
          their normal retention period.
        </p>

        <h2>Your choices and rights</h2>
        <p>
          You can sign out at any time. Depending on the circumstances and the lawful
          basis, you may ask to access, correct, erase, restrict or receive your personal
          information. You may object to processing based on legitimate interests.
          Contact us to make a request or to ask how information is used. Club membership
          changes may need to be made with the Students&apos; Union directly.
        </p>
        <p>
          You can also complain to the UK Information Commissioner&apos;s Office at{" "}
          <a href="https://ico.org.uk/make-a-complaint/">ico.org.uk</a>.
        </p>

        <h2>International processing and changes</h2>
        <p>
          Some of our service providers may process information outside the UK. Where
          that happens, we use the transfer protections required by UK data protection
          law. We may update this policy when the app or its providers change; the date
          at the top shows the latest version.
        </p>

        <h2>Contact</h2>
        <p>
          For questions or privacy requests about this hiking service, email{" "}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a> and mention
          MaybeItsSoftware and the UCL Hiking Club app.
        </p>
      </article>
    </main>
  );
}
