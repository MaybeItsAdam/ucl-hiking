# Hiking Cloud Run jobs

`hiking-member-sync` retrieves the official Hiking Club member and committee
rosters through the shared [`suu`](https://github.com/MaybeItsAdam/suu) Python
package, applies Hiking-specific access policy, then sends one authoritative
snapshot to the website. The website performs the Supabase write so the Cloud
Run job never needs the Supabase service-role key.

## Access model

The job deliberately sends three independent fields:

- `membershipTier`: `taster`, `standard`, or `explorer`, derived from the SU
  membership product name.
- `governanceRole`: `committee`, `principal`, `admin`, or `null`. Committee
  seats come from `suu.retrieve.committee`; principal role keywords default to
  President and Treasurer. Admin is only an explicit environment override.
- `isWalkLeader`: independent of tier. It is derived from a Walk Leader
  committee title or `WALK_LEADER_EMAILS`. A Standard walk leader remains
  Standard and cannot see Explorer-only walks.

## Required environment

```text
HIKING_WEB_URL=https://hiking.example.org
MEMBER_SYNC_SECRET=shared-with-the-web-app
SUU_AUTH_STATE_BASE64=<base64 Playwright storage_state.json>
SUU_GROUP=Hiking Club
```

Optional comma-separated values: `ADMIN_EMAILS`, `WALK_LEADER_EMAILS`, and
`PRINCIPAL_ROLE_KEYWORDS`.

Build and deploy as a Cloud Run Job, then schedule it using Cloud Scheduler:

```bash
gcloud builds submit --tag europe-west2-docker.pkg.dev/PROJECT/jobs/hiking-member-sync
gcloud run jobs deploy hiking-member-sync \
  --image europe-west2-docker.pkg.dev/PROJECT/jobs/hiking-member-sync \
  --region europe-west2 --max-retries 1 --task-timeout 20m
```

Store secrets in Secret Manager and attach them with `--set-secrets`; do not
place an SU session or sync secret in an image or checked-in env file.

## Session health check

`hiking-session-check` answers one question: does the SUU session still sign in?
It makes a single HTTP request to `https://studentsunionucl.org/user` with the
session cookie (no browser). Drupal redirects that to `/user/<id>` when signed in
and to `/user/login` when the session is dead. The result is posted to
`/api/sync/session-status`, which is what the portal's session badge shows.

| Result | Meaning | Exit code |
|---|---|---|
| `active` | Redirected to a profile, so signed in | 0 |
| `expired` | Redirected to the login form | 1 |
| `error` | Blocked (e.g. Cloudflare), unreachable, or unreadable session. Health unknown | 1 |
| `unconfigured` | No session set | 1 |

It reads the session exactly like the member sync (`SUU_SESSION_ID`, or
`SUU_AUTH_STATE_BASE64` / `SUU_AUTH_STATE_JSON`), so it tests what the sync will
actually use. Prefer `SUU_SESSION_ID` in `name=value` form, e.g.
`SSESS41428e…=abc123`.

Spot test locally (prints the result, doesn't report unless both web vars are set):

```bash
SUU_SESSION_ID='SSESS…=…' uv run hiking-session-check
```

Deploy (uses a ~60 MB image without Chromium):

```bash
gcloud builds submit cloud-jobs --config cloud-jobs/cloudbuild.session-check.yaml \
  --substitutions=_IMAGE=europe-west2-docker.pkg.dev/PROJECT/jobs/hiking-session-check
gcloud run jobs deploy hiking-session-check \
  --image europe-west2-docker.pkg.dev/PROJECT/jobs/hiking-session-check \
  --region europe-west2 --max-retries 0 --task-timeout 60s --cpu 1 --memory 512Mi \
  --set-env-vars HIKING_WEB_URL=https://ucl-hiking.vercel.app \
  --set-secrets SUU_SESSION_ID=suu-session-id:latest,MEMBER_SYNC_SECRET=member-sync-secret:latest
gcloud scheduler jobs create http hiking-session-check \
  --location europe-west2 --schedule '*/30 * * * *' --http-method POST \
  --uri https://run.googleapis.com/v2/projects/PROJECT/locations/europe-west2/jobs/hiking-session-check:run \
  --oauth-service-account-email SCHEDULER_SA@PROJECT.iam.gserviceaccount.com
```

Every check is itself a signed-in request, so running it often may also keep the
session alive. Run it hourly or less if you want to measure how long a session
lasts untouched.

## Roster sync (temporary)

`hiking-roster-sync` stands in for member sync until the Toolbox Connector and its
members API replace it — see `docs/plans/connector-rollout-plan.md` in the
adams-campus-toolbox repo, which also lists what to delete when it's retired.

Daily, with the stored SU session (same `suu-session-id` secret as the health check),
it reads every page of `studentsunionucl.org/clubs-societies/hiking-club/members`
over plain HTTP and posts the roster to `/api/sync/roster`.

The SU page has **names but no emails**, so the site can't key it on email like
`/api/sync/members`. Instead:

- `/api/sync/roster` stores the snapshot in `su_roster` (migration
  `20260914000000_su_roster.sql`) and updates or revokes members who joined by
  name match (`sync_source = 'suu-roster'`). Nobody else is touched.
- At sign-in, a UCL account with no member row is let in if its name matches
  exactly one roster entry (`src/lib/roster.ts`); shared names never match.
- Taster / Standard / Explorer map to tiers; membership expiry comes from the
  date range. Unknown membership types are skipped and reported.

It refuses to send or accept an empty roster.

**Which SU login it uses:** the one a principal saved in the portal (checked against
the SU site when saved, read via `/api/sync/suu-session`), falling back to the
`suu-session-id` secret. If the portal's login has ended, the job marks it expired
on the site and retries with the secret in the same run; an expired portal login
is skipped until someone saves a new one.

**Run it now:** the committee Sync button starts this job, using the
`hiking-web-trigger` service account key in Vercel's `GCP_SA_KEY`. It can only
start this job. The schedule is `hiking-roster-sync-daily`, 06:30 London.

```bash
gcloud builds submit cloud-jobs --config cloud-jobs/cloudbuild.roster-sync.yaml \
  --substitutions=_IMAGE=europe-west2-docker.pkg.dev/PROJECT/jobs/hiking-roster-sync
gcloud run jobs deploy hiking-roster-sync \
  --image europe-west2-docker.pkg.dev/PROJECT/jobs/hiking-roster-sync \
  --region europe-west2 --max-retries 1 --task-timeout 120s --cpu 1 --memory 512Mi \
  --set-env-vars HIKING_WEB_URL=https://ucl-hiking.vercel.app \
  --set-secrets SUU_SESSION_ID=suu-session-id:latest,MEMBER_SYNC_SECRET=member-sync-secret:latest
```
