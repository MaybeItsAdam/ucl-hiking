# UCL Hiking Club

A Next.js website and Capacitor app backed by a dedicated Supabase project.
UCL identity is delegated to Adam's Campus Toolbox; Hiking authorization is
resolved from the club's own synced member table on every privileged request.

## Why the shared Toolbox sign-in

Use the existing Toolbox integration rather than creating another Entra app.
It already has UCL tenant approval, exposes a documented external-site flow,
and returns only stable identity (`id`, `email`, `name`). Register the Hiking
site's bare origin under the Hiking organiser in the Toolbox Dev Portal. The
Hiking app exchanges the short-lived browser handoff for its own `HttpOnly`
cookie and never trusts the handoff token for a club role.

Create a separate Entra app only if Hiking later needs its own Microsoft Graph
permissions, independent consent/lifecycle, or must operate when Toolbox is
unavailable. None of those is required for member cross-checking.

## Local setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Set the Supabase URL and service-role key, then apply the migrations with
`MIGRATE_DATABASE_URL=<postgres connection string> npm run db:migrate`.

### Migrations apply themselves in production

`npm run build` runs `scripts/deploy-migrate.mjs` before `next build`. On a Vercel
**production** build (`VERCEL_ENV=production`) it applies any file in
`supabase/migrations/` not yet recorded in `public.schema_migrations`, using the
Supabase integration's `POSTGRES_URL_NON_POOLING`. Preview and local builds skip it.
Each migration runs in one transaction with its ledger row; a failure fails the
build and the previous deployment keeps serving. Add a new migration as a new
file, never by editing an applied one: edits are detected and warned about, not
re-run. Renames, drops and new `NOT NULL` columns still need expand/contract
across two deploys. The service
key is server-only. Browsers have no table grants because Supabase Auth is not
the identity provider.

## Access model

Access is not a single ladder:

| Dimension | Values | Effect |
| --- | --- | --- |
| Membership | Taster, Standard, Explorer | Which walks the member may see/book |
| Governance | Committee, Principal, Admin | Club administration capabilities |
| Walk leader | true/false | Leader tools; does not upgrade membership |

For example, a Standard walk leader can manage their walks but still cannot
open Explorer-only walks. `src/lib/access.ts` is the central capability map.
Role values embedded in the signed cookie are display history only; protected
code reloads the current member row from Supabase.

## Capacitor

The native shell loads the deployed Next.js application so it retains server
routes and Supabase-backed functionality:

```bash
CAPACITOR_APP_URL=https://ucl-hiking.vercel.app npm run cap:sync
npm run cap:ios       # or cap:android
```

UCL sign-in opens in the system browser. Toolbox returns to the allow-listed
`https://<domain>/auth/callback?native=1`; that page immediately opens the
registered `uclhiking://auth/callback` scheme, and the in-app listener exchanges
the fragment for the same `HttpOnly` session used by the website. No universal
link or second Entra callback registration is required.
Browser sign-in returns to the domain where it started, so `uclhiking.org` can
serve the same app later once that domain is attached to Vercel and allowed in
the Toolbox Hiking organiser. Native builds continue to load the configured
`CAPACITOR_APP_URL` until rebuilt with a different URL.

## Store materials

Icons, the Google Play feature graphic, listing copy, screenshot guidance and
tester/reviewer instructions are in [`assets/store/README.md`](./assets/store/README.md).
The hiking app's own privacy policy is at `/privacy`; the store privacy URL is
`https://ucl-hiking.vercel.app/privacy` after this change is deployed.

## Member sync

Adam's Campus Toolbox is the target source for Hiking membership. Its browser
connector stores a complete SU roster, principals confirm each roster row's
Toolbox identity, and a scoped `MEMBERS_READ` developer token exposes only those
confirmed identities to `/api/sync/toolbox-members`.

Keep `TOOLBOX_MEMBERS_AUTHORITATIVE=false` initially. The daily job then reports
members present on only one side and tier mismatches without changing access.
After the identities and comparison have been checked, setting it to `true`
makes ACT authoritative: confirmed members are upserted and previously ACT-owned
rows absent from a successful, recent, non-empty snapshot are revoked. Committee
roles and walk-leader flags remain local Hiking policy.

The [`cloud-jobs`](./cloud-jobs) SU scraper and `/api/sync/roster` name matcher
remain temporarily available for rollback. Retire them only after the ACT shadow
comparison has stayed clean through a membership change and at least seven daily
runs.

## Toolbox webhooks

`/api/webhooks/toolbox` upserts events straight into Supabase, so it is only
open to unsigned deliveries during local development. In production it requires
`TOOLBOX_WEBHOOK_SECRET` and refuses the request with 503 when that is unset.
Signatures are `t=<unix>,v1=<hex>` over `"<t>.<raw body>"` and are accepted
within five minutes of `t`, so a captured delivery cannot be replayed later.
That matches Toolbox's `signWebhook`/`SIGNATURE_TOLERANCE_SECONDS` exactly.

The body Toolbox sends is `{ id, type, createdAt, batchId, organiserId, data }`
with `data` as `{ kind, ...the event row }` — note `type`, not `event`, and
`startTime`/`endTime`, not `startsAt`/`endsAt`. Both vocabularies are accepted,
because the Cloud Run sync job posts the second to `/api/sync/events`. Toolbox
sends no `capacity`, `ticketsSold` or `pricePence` (they are SU ticketing
fields it has no source for), so the upsert writes only the columns a delivery
actually carried rather than resetting those three to zero.

## Checks

```bash
npm run typecheck
npm run lint
npm test
cd cloud-jobs && pytest
```
