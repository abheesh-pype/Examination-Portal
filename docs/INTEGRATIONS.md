# Institution integrations (provisioning + single sign-on)

For the quickest UMS setup (opaque tokens, no signing key) and the full route table, see `EXAM_PORTAL_UMS_INTEGRATION.md`.
This document covers the optional JWT, external identity provider and OIDC setups.

The Exam Portal is tenant-agnostic. Any institution system (UMS or another) can provision students and
assessment assignments, and students can sign in through that institution's OIDC identity provider.
Each institution is one entry in `INTEGRATION_TENANTS`; nothing in the portal is UMS-specific.

## Server configuration (secret manager / environment; never committed)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Existing. Integration tables are created on first use. |
| `INTEGRATION_TENANTS` | JSON array, one object per institution (below). Needed only for JWT bearer tokens and OIDC; opaque tokens from registered clients work without it. |
| `INTEGRATION_ISSUER_URL`, `INTEGRATION_SIGNING_KEY` | Built-in token issuer (below). |
| `OIDC_STATE_SECRET` | 32+ random characters; signs the short-lived sign-in cookie. Required for student SSO. |
| `PORTAL_PUBLIC_URL` | The portal's public HTTPS origin, used in launch URLs. Defaults to `INTEGRATION_ISSUER_URL`. |

```json
[{
  "tenant_id": "institution-001",
  "issuer": "https://idp.example.edu/",
  "jwks_url": "https://idp.example.edu/.well-known/jwks.json",
  "audience": "exam-portal-api",
  "scope": "students:write",
  "oidc": {
    "issuer": "https://idp.example.edu/",
    "client_id": "exam-portal-web",
    "client_secret": "optional, only for confidential clients",
    "redirect_uri": "https://exam.example.edu/api/auth/oidc/callback",
    "scopes": "openid email profile",
    "link_claim": "email"
  }
}]
```

URLs must be HTTPS in production (HTTP allowed for localhost only). `scope` defaults to `students:write`.
`oidc` is optional (provisioning works without SSO); `link_claim` defaults to `email` and requires `email_verified: true`.

## Built-in token issuer (no external identity provider needed for UMS sync)

The portal always issues OAuth 2.0 client-credentials tokens. Without `INTEGRATION_SIGNING_KEY` they are opaque, last 1 hour and are stored hashed.
With the setup below they are signed JWTs instead. Setup, once per deployment:

1. `node scripts/generate-signing-key.mjs` → put the output in the secret manager as `INTEGRATION_SIGNING_KEY`.
2. Set `INTEGRATION_ISSUER_URL` to the portal's public HTTPS URL (and optionally `INTEGRATION_AUDIENCE`, default `exam-portal-api`).
3. Add the tenant as `{ "tenant_id": "institution-001", "builtin": true }` in `INTEGRATION_TENANTS` (scope defaults to `students:write`).
4. Register UMS: `node scripts/create-integration-client.mjs --tenant institution-001 --client-id ums`.
   It prints `EXAM_PORTAL_CLIENT_ID` / `EXAM_PORTAL_CLIENT_SECRET` once; only a scrypt hash is stored.
   Rotate with `--rotate`; remove the tenant from `INTEGRATION_TENANTS` to revoke all its clients.
5. In UMS set `EXAM_PORTAL_TOKEN_URL=<portal>/api/integrations/oauth/token`, `EXAM_PORTAL_STUDENT_UPSERT_URL=<portal>/api/integrations/v1/students`,
   `EXAM_PORTAL_AUDIENCE=exam-portal-api`, `EXAM_PORTAL_SCOPE=students:write`, `UMS_TENANT_ID=institution-001` and the client id/secret.

Details: `POST /api/integrations/oauth/token` (grant `client_credentials`, HTTP Basic or body credentials) returns a 10-minute RS256 JWT carrying
`tenant_id` and `scope`; the public key is at `/.well-known/jwks.json`. A token only works for its own tenant. Ten failed attempts per
IP + client in 5 minutes return `429`, as do more than 30 token requests per minute from one IP (per server process; also rate-limit at your proxy).
If a request names scopes the client lacks, only the allowed ones are granted and `scope` in the response lists them; `invalid_scope` is returned when none are allowed. Key rotation: generate a new key, replace
`INTEGRATION_SIGNING_KEY`, restart; UMS fetches a fresh token automatically (outstanding tokens expire within 10 minutes).
This issuer is for machine clients only; it does not authenticate students.

## Provisioning API

`POST /api/integrations/v1/students` — machine-to-machine; no cookies or browser sessions.

* `Authorization: Bearer <token>`: an opaque token from this portal, or a JWT from the tenant's authorization server or the built-in issuer. JWTs are verified for
  signature (RS*/ES* via `jwks_url`), `iss`, `aud`, `exp` and `scope` against the tenant named in the body.
  Unknown tenant or bad token → `401`; missing scope or wrong tenant → `403`; key set unreachable → `503`.
* `Idempotency-Key` (optional): repeating the same key with the same body returns the stored response without re-applying (for 24 hours); the same key with a different body returns `422`.
* Body (unknown fields such as DOB/password are ignored and never stored):

```json
{ "tenant_id": "institution-001", "external_student_id": "123456", "candidate_id": "123456",
  "name": "Example Student", "email": "student@example.edu", "category": "Undergraduate",
  "sub_category": "Year 1", "status": "active",
  "assigned_assessments": [{ "ums_assessment_id": 42, "name": "Midterm Mathematics", "examination": "Semester 1" }] }
```

* Success `201` (created) / `200` (updated): `{ "ok": true, "result": "created|updated", "external_student_id", "candidate_id", "status", "assigned_assessments": <count applied>, "unmapped_assessments": [ids] }`.
  `candidate_id` in the response is the portal's own six-digit Candidate ID; the match key is always `tenant_id` + `external_student_id`.
* `status: "inactive"` deactivates the candidate and removes assignments this integration made. Assignments made in the portal are never removed.
* Each external assessment is matched to a portal assessment by an explicit mapping, then by `assessment.external_assessment_id`, otherwise by a unique exact
  (examination, name) match among assessments no institution has claimed yet, which is then remembered. Unmatched ids are returned in `unmapped_assessments` and re-applied
  automatically when mapped. Administrators can override with
  `PUT /api/integrations/v1/assessment-mappings` `{ tenant_id, external_assessment_id, assessment_id }` (admin session).

## Student launch from the institution system (no identity provider, no SMTP)

Students sign in to the institution system (UMS) as usual. When they open the exam portal, the institution server calls
`POST /api/integrations/v1/launch-tickets` `{ "tenant_id", "external_student_id" }` with its bearer token (scope **`students:launch`**).
The portal returns `{ "ok": true, "launch_url": "<portal>/launch?ticket=...", "expires_at": "<ISO>", "expires_in": 90 }`; the browser opens it and the portal
starts that provisioned student's session. Tickets are random, stored hashed, single-use, valid for 90 seconds, and refused if the student is unknown
or inactive (also re-checked when redeemed). Set `PORTAL_PUBLIC_URL` (defaults to `INTEGRATION_ISSUER_URL`) to the portal's public HTTPS URL.
`GET /launch` answers a bad ticket with a JSON `401`. `GET /api/auth/launch` redeems the same tickets but redirects failures to the login page with a friendly message.
Clients created before this feature need `--rotate` once to gain the `students:launch` scope (or pass `--scope "students:write students:launch"`).

## Staff single sign-on and examination publishing (Academic Admin)

Scopes: **`staff:launch`** (staff sign-in) and **`assessments:write`** (publish examinations). Built-in clients get both by default; widen an existing one with
`node scripts/create-integration-client.mjs --tenant <id> --client-id <id> --scope "students:write students:launch staff:launch assessments:write results:read" --scopes-only`.

* `POST /api/integrations/v1/staff-launch-tickets` `{ tenant_id, external_user_id, name, email }` returns a single-use 90-second `launch_url`. The portal creates or updates
  a portal user with the **"UMS Administrator"** role (full administrator access) and signs them in. Used for UMS Academic Admins and Organization Admins/Super Admins.
  It never adopts an existing portal account: if the email already belongs to someone else, it answers `409`. A deactivated account answers `403`.
  Accounts created earlier with the former restricted role "UMS Academic Staff" are upgraded on their next sign-in; a role set by a portal administrator is otherwise kept.
* Invigilators and evaluators are not provisioned by UMS: they sign in to the portal directly with their own portal credentials.
* `PUT /api/integrations/v1/assessments` `{ tenant_id, external_assessment_id, name, examination, start_date, end_date, total_time, status }` creates/updates the assessment
  shell (idempotent on tenant + external id) and records the mapping used by student provisioning, so assignments no longer depend on name matching. Questions and sections are
  then authored in the portal (manual entry or bulk upload).
* Limitation: the portal's assessments and question bank are shared across tenants (not tenant-scoped), so institution staff see each other's content.

## Student single sign-on (optional, needs an external OIDC provider)

Authorization Code + PKCE (S256) with `state` and `nonce`. The login page shows "Sign in with your institution" when a tenant has `oidc`
and `OIDC_STATE_SECRET` is set. The ID token is verified (signature, issuer, audience, expiry, nonce). The first sign-in links the
IdP `iss` + `sub` to the provisioned student whose email equals the verified `link_claim` (exactly one match, otherwise refused);
later sign-ins use `iss` + `sub` only. Provisioned students have no DOB, and DOB login stays unavailable for them.
Register `redirect_uri` exactly at the IdP.

## Deployment

1. Register the Exam Portal API and a client-credentials client for the institution at its authorization server (audience, `students:write`).
2. Register the web client for SSO (redirect URI above, PKCE).
3. Set `INTEGRATION_TENANTS` and `OIDC_STATE_SECRET`, restart.
4. Provision one student from the institution system; confirm the response and that the candidate and assignments appear.
5. Sign in as that student through the institution.

Tests: `npm test` (the Vitest route suite on an in-memory PostgreSQL, then the `node --test` unit suites). Neither connects to `DATABASE_URL`.
