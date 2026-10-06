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

Secrets live in Doppler, not in files: project `hiking-webapp` in the **UCL Hiking Club** workplace,
owned by uclhiking@gmail.com. Ask a committee admin to invite you.

```bash
doppler login                    # signed in to the UCL Hiking Club workplace
npm install
npm run dev                      # runs on hiking-webapp/prd
```

If your own Doppler login is for another workplace, keep the club's apart with a wrapper on your
PATH called `doppler-hiking` (`exec doppler --config-dir "$HOME/.doppler-hiking" "$@"`), then
`doppler-hiking login` once. `scripts/doppler.sh` uses it when it's there, plain `doppler` otherwise.

`npm run dev:no-doppler` still reads `.env.local` if you need to work offline.

### Where each secret lives

| Doppler config | Synced to | Holds |
| --- | --- | --- |
| `prd` | Vercel Production (`ucl-hiking.vercel.app`), and your machine via `npm run dev` | everything production needs, including Supabase and `POSTGRES_URL_NON_POOLING` |
| `ci` | GitHub Actions | Android signing, the Play service account, `GOOGLE_SERVICES_JSON_BASE64`, the match deploy key and password, the App Store Connect API key |

Local dev runs on `prd`: it reads the production database either way, so there is no separate dev config.

Vercel's Supabase integration owns the `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`/`_PUBLISHABLE_KEY`
and `POSTGRES_*` names, so Doppler must not hold them: a sync that tries to write one fails and
Doppler disables it. The migration connection string is therefore `MIGRATE_DATABASE_URL` in
Doppler (the session pooler on port 5432), which `deploy-migrate` prefers over the integration's. `SAFETY_DATA_KEY` is in `prd`, which local dev uses too, so
both encrypt with the same key.

Change a secret in Doppler, never in Vercel or GitHub directly (the next sync overwrites it).
Before a deploy that needs a new secret, run `npm run env:check -- prd` (or `ci`). It fails on
missing secrets and on the usual paste mistakes (a short session secret, a safety key that isn't
32 bytes, a service account that isn't JSON), and never prints a value.

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

### Releases

Pushes to `main` upload an Android build to the Play internal track
(`android-internal.yml`) and an iOS build to TestFlight for internal testers
(`ios-testflight.yml`, once the repo variable `IOS_TESTFLIGHT_ENABLED` is
`true`). To send a build to external TestFlight testers, run **iOS TestFlight**
by hand with `lane=external`. That build goes through Beta App Review and then
to the `UCL Hiking Early Access` group. iOS signing comes from the shared
`MaybeItsSoftware/match-certs` repo via `fastlane match`.

## Store materials

Icons, the Google Play feature graphic, listing copy, screenshot guidance and
tester/reviewer instructions are in [`assets/store/README.md`](./assets/store/README.md).
The hiking app's own privacy policy is at `/privacy`; the store privacy URL is
`https://ucl-hiking.vercel.app/privacy` after this change is deployed.

## Member sync

Membership is Adam's Campus Toolbox's SU roster for the club. Its browser
connector and nightly pipeline keep a complete copy of the SU member list
(`GET /api/v1/organisers/:id/members`, under a `MEMBERS_READ` developer token),
and Toolbox links each row to a UCL login: automatically when the name is
unambiguous on both sides (at sign-in and daily), and by a principal on its
`/connector` page for the rest. A member is someone whose login is linked;
names are never matched here. Every read of the roster is refused unless it is
complete and under 72 hours old.

- **Sign-in** (`/api/auth/exchange`) admits a login linked on the roster at
  that row's tier and expiry, so a new member gets in at once. Rows the roster
  owns (`sync_source = 'toolbox-members'`) are re-read at every sign-in and
  revoked once the login is no longer on it.
- **The daily sync** (`/api/sync/toolbox-members`, 06:45 UTC) upserts every
  linked member by login, then email, and revokes roster-owned rows Toolbox no
  longer lists. A roster with nobody linked changes nothing. It never touches
  committee accounts from Toolbox sign-in, committee roles or walk-leader flags.
- **The Members page** lists the whole roster, with site accounts attached by
  login.

Every sync run leaves a row in `member_sync_runs`, failures included, with a
`comparison` of how far the members table was from Toolbox beforehand:

```sql
select started_at, received_count, upserted_count, revoked_count, comparison, error
from member_sync_runs where source = 'toolbox-members' order by started_at desc limit 10;
```

### Roles set on the Members page

One other writer sets roles: Toolbox sign-in (`/api/auth/exchange`). A role
changed on the Members page is *locked* (`members.governance_role_locked`,
`walk_leader_locked`) and sign-in keeps the locked value; "Return to sync" clears the lock. Any governance role can make
someone a walk leader. Only a principal (or admin) can add or remove a committee
seat. Principal and admin are never granted in the app, and a Toolbox promotion
to either overrides a lock.

## Walks: plans, attendees and the day itself

Everything about a walk is keyed by `events.suu_event_id`, because Toolbox's
reconcile recreates event rows with new uuids.

- **Plans** (`event_plans`): the trip brief leaders write on the event page.
  Committee assign the leader and backmarker, from the plan or the Rota.
- **Attendees** (`event_attendees`): SU ticket holders arrive from Toolbox via
  `/api/sync/toolbox-attendees` (daily cron, and on demand from the day page).
  It calls `GET /api/v1/organisers/:id/events/:eventId/attendees`, expecting
  `{ linked, syncedAt, attendees: [{ name, email, tier }] }` under the
  `ATTENDEES_READ` scope. A list exists only once a principal has **linked**
  the walk to its SU ticket page; the Connector then reads the SU's
  "Tickets (CSV)" export and re-sends it until the day after the walk.
  - An unlinked (or merged) walk comes back `not_linked`, and a 404 (Toolbox
    doesn't host it for the club) `not_found`; the sync moves on. A 403 (scope
    not granted) logs `unavailable` in `event_sync_runs` and stops.
  - Toolbox's rules for consumers are kept here: each walk is asked at most
    every 15 minutes (`ticket_list_checks`), the day page shows the list's
    age, buyers' emails never leave the server, and 7 days after a walk the
    nightly sync deletes no-show non-members and refunds and blanks everyone
    else's email (`purgeExpiredTicketHolders`).
  - Either way leaders can add people on the day.
- **Emergency details** (`member_safety`) are opt-in and encrypted in the app
  with `SAFETY_DATA_KEY`. Only a walk's leader and backmarker can read them,
  for members on that walk, from 24 h before to 24 h after, and every read is
  audited (`safety.view`). Without the key the feature says it's switched off.
- **The day page** (`/portal/events/:id/day`) keeps its register in
  `localStorage` for offline use and replays check-ins when back online. The
  copy is deleted 24 h after the walk.

## Notifications

`src/lib/notify.ts` writes every notification to the member's inbox (the bell)
and, when `FIREBASE_SERVICE_ACCOUNT` is set, pushes it to their phone through
FCM HTTP v1. What sends one:

| Trigger | Where |
| --- | --- |
| A walk someone is on is cancelled, moved or relocated | Toolbox webhook and daily reconcile (`src/lib/eventChanges.ts`) |
| Day-before reminder: meet, kit, forecast | `/api/cron/daily`, 17:00 UTC |
| Kit approved or declined; loan overdue (then weekly) | equipment request PATCH; `/api/cron/daily` |
| Made leader or backmarker | walk plan PUT/PATCH |
| Committee broadcast | Club tab |

Vercel Hobby only runs crons daily, so reminders go once, the evening before.
`sent_reminders` stops a retried or hand-run cron sending anything twice.

Push on the phone needs three things: `google-services.json` in the Android
build (CI writes it from the `GOOGLE_SERVICES_JSON_BASE64` secret), the
`FIREBASE_SERVICE_ACCOUNT` env var on Vercel, and then
`NEXT_PUBLIC_PUSH_ENABLED=true`.

iOS push is not built yet (deferred). An APNs key alone is not enough: on iOS
`@capacitor/push-notifications` returns a raw APNs token, which FCM rejects, so
iPhones would register but never receive anything. It needs, in order:

1. Push Notifications ticked on the `org.uclhiking.app` App ID, and an APNs key
   (`.p8`) uploaded to the Firebase project's Cloud Messaging settings.
2. An iOS app `org.uclhiking.app` in Firebase; its `GoogleService-Info.plist`
   in Doppler `ci` as `GOOGLE_SERVICE_INFO_PLIST_BASE64`, written into
   `ios/App/App/` by the iOS workflow.
3. The Firebase Messaging pod, and `AppDelegate` handing Capacitor the FCM token
   instead of the APNs token (the pattern in Capacitor's push guide).
4. The Push capability and `aps-environment` entitlement on the App target, then
   `fastlane ios signing` to regenerate the match profile with push in it.

Keep `NEXT_PUBLIC_PUSH_ENABLED` off until a build with all four is on TestFlight;
the server side (`src/lib/notify.ts`) needs no change.

## Club tab (committee)

Any governance role sees **Club**; principals and admins also see Money and Incidents.

- **Stats**: the club year so far, covering walks run, different walkers, the repeat rate, how full walks were
  (SU tickets ÷ capacity), no-shows (only on walks whose register was used), walkers per month,
  top leaders and taster conversion. Conversion is read from `member_tier_history`, which a trigger
  fills whenever a member's tier changes, so it only counts changes after this migration.
- **Broadcast**: sends to an audience (everyone, a tier, leaders and committee, or the people on a walk)
  through `notify()`. It is limited to 5 an hour per sender and is audited.
- **Money**: ticket income per trip is `price × tickets sold` from the SU numbers. The treasurer adds
  costs and other income lines. `/api/club/finance/csv` exports the year.
- **Handbook**: Markdown pages in `club_docs`, rendered by `lib/markdown.ts` as React elements
  and never as HTML. Three empty pages are seeded. Only principals can delete a page.
- **Incidents**: the reports leaders file from the day-of page. Principals only, because they can
  describe injuries.

## Toolbox webhooks

`/api/webhooks/toolbox` upserts events straight into Supabase, so it is only
open to unsigned deliveries during local development. In production it requires
`TOOLBOX_WEBHOOK_SECRET` and refuses the request with 503 when that is unset.
Signatures are `t=<unix>,v1=<hex>` over `"<t>.<raw body>"` and are accepted
within five minutes of `t`, so a captured delivery cannot be replayed later.
That matches Toolbox's `signWebhook`/`SIGNATURE_TOLERANCE_SECONDS` exactly.

The body Toolbox sends is `{ id, type, createdAt, batchId, organiserId, data }`
with `data` as `{ kind, ...the event row }` — note `type`, not `event`, and
`startTime`/`endTime`, not `startsAt`/`endsAt`. Both vocabularies are accepted:
the second is what the retired SU sync job sent, and a contract that only
understands one breaks the moment either end changes. Toolbox
sends no `capacity`, `ticketsSold` or `pricePence` (they are SU ticketing
fields it has no source for), so the upsert writes only the columns a delivery
actually carried rather than resetting those three to zero.

## Checks

```bash
npm run typecheck
npm run lint
npm test
```
