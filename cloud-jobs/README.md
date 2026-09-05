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
