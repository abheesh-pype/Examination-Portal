# Institution integrations (provisioning + single sign-on)

The Exam Portal is tenant-agnostic. Any institution system (UMS or another) can provision students and
assessment assignments, and students can sign in through that institution's OIDC identity provider.
Each institution is one entry in `INTEGRATION_TENANTS`; nothing in the portal is UMS-specific.

## Server configuration (secret manager / environment; never committed)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Existing. Integration tables are created on first use. |
| `INTEGRATION_TENANTS` | JSON array, one object per institution (below). Unset = integration endpoints answer `503`. |
| `INTEGRATION_ISSUER_URL`, `INTEGRATION_SIGNING_KEY` | Built-in token issuer (below). |
| `OIDC_STATE_SECRET` | 32+ random characters; signs the short-lived sign-in cookie. Required for student SSO. |

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

The portal can issue the OAuth 2.0 client-credentials tokens itself. Setup, once per deployment:

1. `node scripts/generate-signing-key.mjs` → put the output in the secret manager as `INTEGRATION_SIGNING_KEY`.
2. Set `INTEGRATION_ISSUER_URL` to the portal's public HTTPS URL (and optionally `INTEGRATION_AUDIENCE`, default `exam-portal-api`).
3. Add the tenant as `{ "tenant_id": "institution-001", "builtin": true }` in `INTEGRATION_TENANTS` (scope defaults to `students:write`).
4. Register UMS: `DATABASE_URL=... node scripts/create-integration-client.mjs --tenant institution-001 --client-id ums`.
   It prints `EXAM_PORTAL_CLIENT_ID` / `EXAM_PORTAL_CLIENT_SECRET` once; only a scrypt hash is stored.
   Rotate with `--rotate`; remove the tenant from `INTEGRATION_TENANTS` to revoke all its clients.
5. In UMS set `EXAM_PORTAL_TOKEN_URL=<portal>/api/integrations/oauth/token`, `EXAM_PORTAL_STUDENT_UPSERT_URL=<portal>/api/integrations/v1/students`,
   `EXAM_PORTAL_AUDIENCE=exam-portal-api`, `EXAM_PORTAL_SCOPE=students:write`, `UMS_TENANT_ID=institution-001` and the client id/secret.

Details: `POST /api/integrations/oauth/token` (grant `client_credentials`, HTTP Basic or body credentials) returns a 10-minute RS256 JWT carrying
`tenant_id` and `scope`; the public key is at `/.well-known/jwks.json`. A token only works for its own tenant. Ten failed attempts per
IP + client in 5 minutes return `429` (per server process; also rate-limit at your proxy). Key rotation: generate a new key, replace
`INTEGRATION_SIGNING_KEY`, restart; UMS fetches a fresh token automatically (outstanding tokens expire within 10 minutes).
This issuer is for machine clients only; it does not authenticate students.

## Provisioning API

`POST /api/integrations/v1/students` — machine-to-machine; no cookies or browser sessions.

* `Authorization: Bearer <JWT>` issued by the tenant's authorization server (OAuth 2.0 client credentials). Verified for
  signature (RS*/ES* via `jwks_url`), `iss`, `aud`, `exp` and `scope` against the tenant named in the body.
  Unknown tenant or bad token → `401`; missing scope → `403`; key set unreachable → `503`.
* `Idempotency-Key` (optional): repeating the same key for the same student returns the stored result without re-applying.
* Body (unknown fields such as DOB/password are ignored and never stored):

```json
{ "tenant_id": "institution-001", "external_student_id": "123456", "candidate_id": "123456",
  "name": "Example Student", "email": "student@example.edu", "category": "Undergraduate",
  "sub_category": "Year 1", "status": "active",
  "assigned_assessments": [{ "ums_assessment_id": 42, "name": "Midterm Mathematics", "examination": "Semester 1" }] }
```

* Success `201` (created) / `200` (updated): `{ "ok": true, "result": "created|updated", "external_student_id", "candidate_id", "status", "assigned_assessments": <count applied>, "unmapped_assessments": [ids] }`.
  `candidate_id` in the response is the portal's own six-digit Candidate ID; the match key is always `tenant_id` + `external_student_id`.
* `status: "inactive"` deactivates the candidate and removes assignments this integration made.
* Each external assessment is matched to a portal assessment by an explicit mapping, otherwise by a unique exact
  (examination, name) match, which is then remembered. Unmatched ids are returned in `unmapped_assessments` and re-applied
  automatically when mapped. Administrators can override with
  `PUT /api/integrations/v1/assessment-mappings` `{ tenant_id, external_assessment_id, assessment_id }` (admin session).

## Student launch from the institution system (no identity provider, no SMTP)

Students sign in to the institution system (UMS) as usual. When they open the exam portal, the institution server calls
`POST /api/integrations/v1/launch-tickets` `{ "tenant_id", "external_student_id" }` with its bearer token (scope **`students:launch`**).
The portal returns `{ "ok": true, "launch_url": "<portal>/api/auth/launch?ticket=...", "expires_in": 60 }`; the browser opens it and the portal
starts that provisioned student's session. Tickets are random, stored hashed, single-use, valid for 60 seconds, and refused if the student is unknown
or inactive (also re-checked when redeemed). Set `PORTAL_PUBLIC_URL` (defaults to `INTEGRATION_ISSUER_URL`) to the portal's public HTTPS URL.
Clients created before this feature need `--rotate` once to gain the `students:launch` scope (or pass `--scope "students:write students:launch"`).

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

Tests: `npm test`.
