# JobConnect — International recruitment platform

Work-contract requests and international recruitment: candidates submit a contract
request and receive a trackable reference code, recruiters publish jobs and receive
applications with resumes, admins moderate everything.

**Live:** <https://jc.jobconnectdz.workers.dev>

**Android app:** built by GitHub Actions (`.github/workflows/android.yml`), APK attached to every run. The admin console exists **only** inside that APK.

---

## Architecture

| Layer | Technology |
|---|---|
| API + web app | Cloudflare Workers (single ES module, no build step at the edge) |
| Database | Supabase Postgres 17 (`eu-west-2`) accessed via PostgREST |
| Resume storage | Supabase Storage — **private** bucket `cvs` |
| Password hashing | Postgres `pgcrypto` (`crypt` / bcrypt cost 11) via RPC |
| Sessions | HS256 JWT signed with WebCrypto, 12 h expiry |
| Messaging | Telegram-style threads, polling (no websockets needed) |
| Android | WebView wrapper + bundled admin console, WorkManager notifications |
| Source | GitHub (this repo) |

The whole app — API and static frontend — is one Worker. `/api/*` is handled by the
Worker; `index.html`, `style.css` and `app.js` are inlined at build time and served
from the same origin, so there is no CORS problem and no separate static host.

> **Why hashing lives in Postgres:** the Workers free plan allows ~10 ms of CPU per
> request. bcrypt inside the Worker would blow that budget, so
> `public.jc_hash_password()` / `public.jc_verify_password()` run in the database and
> the Worker only calls them over RPC. `EXECUTE` is revoked from `anon` and
> `authenticated`, granted to `service_role` only.

> **Why there is a hand-written multipart parser:** `request.formData()` in this
> runtime flattens file parts into plain strings, which silently discarded resumes.
> `parseMultipart()` in `src/worker.js` parses the raw bytes instead.

## Repository layout

```
public/            index.html, style.css, app.js  (the frontend)
src/worker.js      the entire API + static file server
build.js           inlines public/ into dist/worker.js as __ASSETS__
scripts/deploy.js  deploys to Cloudflare via the REST API (no wrangler needed)
scripts/e2e-test.mjs  48-check end-to-end test suite against a live deployment
schema.sql         Postgres schema, RPC functions, RLS, storage bucket
```

## Deploy

```bash
cp .env.example .env      # then fill it in
set -a && . ./.env && set +a
npm run deploy            # build.js + scripts/deploy.js
```

Required variables: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET` (32+ chars).
`scripts/deploy.js` uploads the Worker, stores the values as encrypted Worker
secrets, and enables the `workers.dev` route.

Tests: `BASE=https://… node scripts/e2e-test.mjs`

## First-time database setup

1. Run `schema.sql` against the project (Supabase SQL editor, or
   `POST /v1/projects/{ref}/database/query` with a management token).
2. Create the first admin — never commit the password, and change it after login:

```sql
insert into public.users (name, email, password_hash, role)
values ('Administrateur', 'admin@jobconnect.example',
        public.jc_hash_password('REPLACE_WITH_A_LONG_PASSWORD'), 'admin');
```

## API

| Method | Path | Access |
|---|---|---|
| `GET` | `/api/health` | public |
| `POST` | `/api/auth/register` | public — candidate needs a CV, recruiter does not |
| `POST` | `/api/auth/login` | public |
| `GET` | `/api/auth/me` | authenticated |
| `GET` | `/api/plans` | public |
| `POST` | `/api/subscriptions` | candidate / recruiter |
| `GET` | `/api/subscriptions/me` | authenticated |
| `GET` | `/api/jobs` | public — `?q=&country=&type=` |
| `POST` | `/api/jobs` | recruiter (pending) / admin (published) |
| `GET` | `/api/recruiter/jobs` | recruiter / admin |
| `POST` | `/api/jobs/:id/apply` | candidate |
| `GET` | `/api/recruiter/applications` | recruiter / admin |
| `GET` | `/api/recruiter/applications/:ref/cv` | recruiter owning the job / admin |
| `POST` | `/api/applications` | public — direct contract request |
| `GET` | `/api/applications/track/:ref` | public |
| `GET` | `/api/candidate/applications` | candidate |
| `GET` | `/api/admin/overview` | admin |
| `GET` | `/api/admin/applications` | admin |
| `GET` | `/api/admin/subscriptions` | admin |
| `GET` | `/api/admin/users/:id/cv` | admin |
| `PATCH` | `/api/admin/applications/:ref` | admin — `received`, `under_review`, `shortlisted`, `approved`, `rejected`, `completed` |
| `PATCH` | `/api/admin/jobs/:id` | admin — `pending`, `published`, `rejected`, `closed` |

## Security notes

- Row Level Security is enabled on every table; all access goes through the Worker
  using the `service_role` key, which is stored as an encrypted Worker secret and
  never reaches the browser.
- Resumes are in a **private** bucket. Downloads are authorised per role: a recruiter
  can only fetch a CV attached to a job they own.
- Uploads are limited to 5 MB and to `.pdf` / `.doc` / `.docx`.
- Login and registration are rate-limited per IP; login always runs the hash
  comparison so timing does not reveal whether an account exists.
- Validation happens server-side; uploaded filenames are never used as storage paths
  (UUIDs are generated instead).

## Limitations

- **No payment processor.** Premium plans are recorded as `pending_payment`; no card
  data is collected and nothing is charged. Integrate a provider, verify webhooks
  server-side, and handle renewals, cancellations and refunds before selling access.
- Interface is English only.
- No email delivery yet (verification, password reset, status-change notifications).
- No malware scanning on uploads; add it before accepting third-party resumes at scale.
- Obtain legal review for privacy, recruitment and subscription rules per market.
- Job listings are entered by recruiters and moderated by an admin. JobConnect does
  not guarantee visas, offers or employment.

## v1 → v2

v1 was an Express + SQLite server (`server.js`) with a `public/` folder that was
never committed. It could not run on Cloudflare and had no host. This version
replaces it entirely: same API surface and behaviour, ported to Workers + Postgres,
with the frontend restored and the missing Premium plans section added.
`server.js` and its dependencies are removed; see git history for the original.
