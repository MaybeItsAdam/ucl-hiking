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

Apply [the initial migration](./supabase/migrations/20260904000000_initial_schema.sql)
to a new Supabase project, then set its URL and service-role key. The service
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
CAPACITOR_APP_URL=https://hiking.example.org npm run cap:sync
npm run cap:ios       # or cap:android
```

UCL sign-in opens in the system browser. Toolbox returns to the allow-listed
`https://<domain>/auth/callback?native=1`; that page immediately opens the
registered `uclhiking://auth/callback` scheme, and the in-app listener exchanges
the fragment for the same `HttpOnly` session used by the website. No universal
link or second Entra callback registration is required.

## Member sync

The [`cloud-jobs`](./cloud-jobs) package is a Google Cloud Run Job. It uses
`suu.retrieve.members.fetch_members` and `suu.retrieve.committee.fetch_committee`
instead of duplicating Students' Union portal automation, maps Hiking-specific
policy, and posts a full snapshot to `/api/sync/members`. Missing rows in a
successful non-empty snapshot are revoked immediately.

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
