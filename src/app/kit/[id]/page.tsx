import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ClubMark } from "@/components/ClubMark";
import { isItemId, kitAppUrl } from "@/lib/kitTag";
import { APP_STORE_URL, noIndex, PLAY_STORE_URL, SITE_NAME } from "@/lib/seo";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * What a kit tag opens when the app isn't there to catch it: the URL written on
 * every tag (src/lib/kitTag.ts). Public, and says only what is printed on the
 * kit anyway: that it's the club's, its asset code, label and kind. Nothing
 * about who has it, where it's kept or its state.
 *
 * A member who handles kit goes straight on to the item in the equipment
 * portal (inside the app too, where KitLinkBridge sends kit links here).
 * Never indexed: the ids are only useful to someone holding the tag.
 */

// Where a finder writes. The club has no kit-specific address yet.
const KIT_CONTACT_EMAIL = "support@uclhiking.org";
// Set by the native shell (capacitor.config.ts appendUserAgent).
const APP_USER_AGENT = "UCLHikingApp";

export const metadata: Metadata = {
  title: `Club equipment | ${SITE_NAME}`,
  description: `This is ${SITE_NAME} equipment.`,
  ...noIndex,
};

interface PublicItem {
  assetCode: string;
  label: string | null;
  kind: string | null;
}

async function publicItem(id: string): Promise<PublicItem | null> {
  try {
    const { data } = await getSupabaseAdmin()
      .from("equipment_items")
      .select("asset_code, label, equipment:equipment_id(name)")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const equipment = (Array.isArray(data.equipment) ? data.equipment[0] : data.equipment) as { name?: string } | null;
    return { assetCode: data.asset_code, label: data.label ?? null, kind: equipment?.name ?? null };
  } catch {
    // The page still says whose kit it is when the database can't be reached.
    return null;
  }
}

export default async function KitTagPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  if (!isItemId(raw)) notFound();
  const id = raw.toLowerCase();

  const member = await getCurrentMember().catch(() => null);
  // Every member can open the equipment page and see what this is and who has it.
  if (member) redirect(`/portal/equipment?item=${id}`);

  const [item, ua] = await Promise.all([publicItem(id), headers().then((h) => h.get("user-agent") ?? "")]);
  const inApp = ua.includes(APP_USER_AGENT);
  const ios = /iPhone|iPad|iPod/i.test(ua);
  const android = /Android/i.test(ua);

  const name = item ? item.label || item.kind : null;
  const reference = item?.assetCode ?? id;
  const subject = encodeURIComponent(`Found club kit: ${reference}`);
  const body = encodeURIComponent(
    `I've found a piece of ${SITE_NAME} equipment.\n\nTag: ${item?.assetCode ? `${item.assetCode} (${id})` : id}\nWhere it is: \n`,
  );

  return (
    <main className="privacy-page kit-public">
      <header className="privacy-header">
        <Link href="/" className="privacy-brand" aria-label={`${SITE_NAME} home`}>
          <ClubMark size={42} />
          <span>{SITE_NAME}</span>
        </Link>
      </header>
      <article className="privacy-content kit-public-content">
        <p className="privacy-eyebrow">{SITE_NAME} equipment</p>
        <h1>{item ? item.assetCode : "Club kit"}</h1>
        {name && <p className="kit-public-name">{item?.kind && item.label ? `${item.label} · ${item.kind}` : name}</p>}

        <dl className="kit-public-facts">
          <div>
            <dt>Belongs to</dt>
            <dd>{SITE_NAME}, a student society at UCL</dd>
          </div>
          <div>
            <dt>Item id</dt>
            <dd className="kit-public-id">{id}</dd>
          </div>
        </dl>

        <h2>Found this?</h2>
        <p>
          Thank you for checking. Please email{" "}
          <a href={`mailto:${KIT_CONTACT_EMAIL}?subject=${subject}&body=${body}`}>{KIT_CONTACT_EMAIL}</a> with the code
          above and where it is, and someone from the club will arrange to collect it.
        </p>

        {inApp ? (
          <>
            <h2>Club members</h2>
            <p>Sign in to see this item in the equipment portal.</p>
            <div className="kit-public-actions">
              <Link className="kit-btn primary" href="/auth/signin">
                Sign in
              </Link>
            </div>
          </>
        ) : (
          <>
            <h2>Club members</h2>
            <p>Open it in the {SITE_NAME} app, or sign in on the website, to see it in the equipment portal.</p>
            <div className="kit-public-actions">
              {(ios || android) && (
                <a className="kit-btn primary" href={kitAppUrl(id)}>
                  Open in the app
                </a>
              )}
              <Link className="kit-btn" href="/auth/signin">
                Sign in on the web
              </Link>
            </div>
            <div className="kit-public-stores" aria-label="Get the app">
              {!android && (
                <a className="kit-btn" href={APP_STORE_URL}>
                  App Store
                </a>
              )}
              {!ios && (
                <a className="kit-btn" href={PLAY_STORE_URL}>
                  Google Play
                </a>
              )}
            </div>
          </>
        )}
      </article>
    </main>
  );
}
