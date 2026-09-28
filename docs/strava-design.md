# AWS hosting, Strava integration + accounts — design

Branch: `strava-integration`. Scope: **move the site to AWS** (off GitHub Pages), **Phase 1**
(Strava sign-in, auto-upload, profile prefill) and **Phase 2** (accounts, ride history across
devices, progress over time). Friends/leaderboards (Phase 3) come later but the data model allows
them.

## Constraints (Strava, as of Sept 2026)

- **No PKCE.** Token exchange and refresh require the client secret → a server must hold it.
  ([auth docs](https://developers.strava.com/docs/authentication/))
- **Strava data is shown only to its owner.** Since Nov 2024 apps may not display a user's Strava
  data to other users. Friend features must use **Big Bib Energy's own ride records**, never data
  fetched from Strava. No AI training on Strava data.
  ([press](https://press.strava.com/articles/updates-to-stravas-api-agreement))
- **Athlete capacity:** new apps are 1 athlete ("Single Player Mode"); self-upgrade to 10; beyond
  that needs Strava review. ([rate limits](https://developers.strava.com/docs/rate-limits/))
- **Rate limits:** 200 req / 15 min, 2,000 / day (400 / 4,000 at capacity 10). Not a concern.
- **Uploads:** `POST /uploads` (`activity:write`), FIT accepted, poll `GET /uploads/:id` ≥ 1 s,
  duplicate detection built in. ([uploads](https://developers.strava.com/docs/uploads/))
- **Branding:** official "Connect with Strava" button and "Compatible with Strava" mark; don't
  mimic Strava's look.

## Architecture

Everything is on one origin, `https://<domain>`, served by CloudFront (all in Terraform, us-east-1):

```
                        ┌──────────────── CloudFront (https://<domain>, ACM cert) ────────────────┐
 browser ──── HTTPS ──▶ │  /*      → S3 site bucket (private, OAC)    index.html no-cache,       │
                        │                                             hashed assets immutable     │
                        │  /api/*  → Lambda Function URL (OAC, IAM auth — not publicly invokable) │
                        └──────────────────────────────────────┬──────────────────────────────────┘
                                                               ▼
                         Lambda (Go, arm64, reserved concurrency 5)
                          ├─ DynamoDB (on-demand, single table, TTL)
                          ├─ S3 (private): .fit files
                          ├─ SSM SecureString: Strava client secret
                          ├─ CloudWatch Logs (14-day retention)
                          └─ Strava API (OAuth token, athlete, uploads)
```

- **Same origin for site and API:** no CORS, and sessions are **HttpOnly cookies** (JS can't read
  them, so XSS can't steal a session).
- **The Lambda is reachable only through CloudFront** (Origin Access Control on the Function URL).
  CloudFront doesn't sign request bodies for Lambda OAC, so the SPA sends an
  `x-amz-content-sha256` header (SubtleCrypto) on `POST`/`PUT`.
- **Response headers policy:** CSP (self + Google Fonts), HSTS, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy: bluetooth=(self)`.
- The site moves to the domain root, so Vite's `BASE_PATH` goes back to `/`.
- Local-only mode keeps working with no account; signing in adds sync and Strava.
- **GitHub Pages is turned off** once the AWS site is live, and the Pages workflow is removed. The
  repo can then go private.

### Auth flow

1. SPA redirects to `strava.com/oauth/authorize` (client ID is public) with
   `scope=read,activity:write,profile:read_all`, `redirect_uri` = `https://<domain>/`, and a random
   `state` kept in `sessionStorage`.
2. Strava redirects back with `?code&state`; the SPA checks `state` and calls `POST /auth/strava`.
3. Lambda exchanges the code (with the secret), upserts the athlete (name, photo, FTP, weight,
   HR zones), stores Strava tokens **server-side**, and sets a session cookie: an opaque 256-bit
   random value (`HttpOnly; Secure; SameSite=Lax; Path=/api`, 90 days), of which only the SHA-256
   is stored.
4. The browser sends the cookie automatically. State-changing requests must also carry
   `X-BBE: 1` (a custom header cross-site forms can't send) as CSRF defence. Strava tokens never
   reach the browser; the Lambda refreshes them when they are within 5 minutes of expiring.

### API (Phase 1 + 2), all under `/api`

| Method | Path | Does |
|---|---|---|
| `POST` | `/auth/strava` | Code → session; returns profile |
| `POST` | `/auth/logout` | Delete this session |
| `GET` | `/me` | Profile + app settings (FTP, LTHR, rider, mode) |
| `PUT` | `/me/settings` | Save app settings |
| `DELETE` | `/me` | Deauthorize at Strava, delete all data |
| `POST` | `/rides` | Multipart: ride summary JSON + `.fit`. Stores, uploads to Strava, returns activity link |
| `GET` | `/rides?since=` | Ride summaries for history and progress |
| `GET` | `/rides/{id}/fit` | Re-download the `.fit` (presigned S3 URL) |

Uploads use `sport_type=Ride`, `trainer=1` (indoor ride) and an `external_id` of the ride ID so
retries can't create duplicates. Title and description are generated, e.g.
*"Sweet Spot 3×10 · 94% on target"* / *"Dialled in. Big Bib Energy 🔥"*.

### Data (DynamoDB single table)

| PK | SK | Attributes |
|---|---|---|
| `ATHLETE#<stravaId>` | `PROFILE` | name, photo, settings, Strava tokens + expiry, createdAt |
| `ATHLETE#<stravaId>` | `RIDE#<startedAt>#<rideId>` | summary (existing `RideRecord` shape), stravaActivityId, fitKey |
| `SESSION#<sha256>` | `SESSION` | athleteId, `ttl` |

Phase 3 adds `CREW#…` items (opt-in membership) that read only `RIDE#` items, never Strava data.

## Repo layout

```
api/            Go module: Lambda handler + router, strava client, store
  cmd/lambda    Lambda entrypoint
  cmd/local     Same handler on net/http :8787; Vite proxies /api → it in `npm run dev`
infra/
  bootstrap/    One-time, applied locally: state bucket + GitHub OIDC deploy role
  main/         CloudFront, ACM, DNS, site bucket, Lambda + Function URL, DynamoDB,
                .fit bucket, SSM param, IAM, logs
src/            Web app (+ .fit encoder, API client, sign-in UI)
```

- Terraform state in S3 with native locking (`use_lockfile`).
- The Strava secret is **never in Terraform state**: Terraform creates the SSM parameter with a
  placeholder and `ignore_changes` on its value; it's set once with the AWS CLI.
- CI: GitHub Actions assumes the OIDC role (no stored AWS keys). On push to `main`: test, build
  the Go binary, `terraform apply`, build the site, `aws s3 sync` (assets immutable,
  `index.html` no-cache), and invalidate `/index.html`.
- Domain: a Terraform variable. The ACM certificate is DNS-validated; if the domain's DNS is in
  Route 53 Terraform manages the records, otherwise it outputs the CNAMEs to add by hand.

## Milestones

0. **Move hosting to AWS:** bootstrap, CloudFront + S3 site, domain + certificate, deploy
   workflow; switch off GitHub Pages once live.
1. **.fit export** in the browser (activity, session, laps per block, 1 Hz records), with tests,
   and a "Download .fit" button on the summary. Useful on its own.
2. **Lambda skeleton:** `/api/health` behind CloudFront (OAC), local dev proxy.
3. **Sign in with Strava:** OAuth, sessions, profile prefill (FTP / weight / HR zones → settings).
4. **Rides API + auto-upload:** `POST /rides`, S3 `.fit`, Strava upload + poll, "View on Strava"
   on the summary. Offline rides queue locally and upload on next sign-in.
5. **History + progress:** rides synced across devices, local history migrated on first sign-in,
   progress over time (rides/week, TSS, on-target %, FTP) on home.

## Needs from you

- The domain (and whether its DNS is in Route 53).
- A Strava API app (strava.com/settings/api): callback domain `<domain>` (and `localhost` for
  dev). Gives the client ID + secret.
- AWS credentials locally (SSO or keys) to apply `infra/bootstrap` once; after that CI deploys.
- A few GitHub repo variables (role ARN, API URL, Strava client ID), which bootstrap outputs.

Cost at our scale: ~$0/month (CloudFront, Lambda, DynamoDB and SSM free tiers; S3 pennies),
plus $0.50/month if the domain's hosted zone is in Route 53.
