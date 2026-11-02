# UMS ↔ Exam Portal Integration

The Exam Portal implements the inbound API that the UMS integration client calls. UMS connects by configuration only: create a client on the portal, then set the UMS variables below.

This is the quickest setup and needs no signing key. For signed JWT tokens, an external identity provider, or student OIDC sign-in, see `docs/INTEGRATIONS.md`.

This document contains no live credentials. Hand over client secrets only through an approved secret manager. Never put them in tickets, chat, committed files or screenshots.

## Connecting UMS

1. Deploy the portal on HTTPS and set `PORTAL_PUBLIC_URL` (for example `https://exam.example.edu`). Launch URLs and the post-launch redirect use this origin. If it is unset, `INTEGRATION_ISSUER_URL` is used.
2. Create a client on the portal server. The secret is printed once and only its scrypt hash is stored:

   ```bash
   node scripts/create-integration-client.mjs --client-id ums-prod --tenant-id <agreed-tenant-id>
   # optional: --scopes "students:write students:launch"   (default: all five scopes)
   # rotate:   --rotate   (issues a new secret and revokes existing opaque tokens)
   # scopes:   --scopes-only   (changes scopes without touching the secret)
   ```

3. Configure the **UMS server** (UMS's own variable names):

   | UMS setting | Value |
   |---|---|
   | `UMS_TENANT_ID` | The `--tenant-id` used above |
   | `EXAM_PORTAL_TOKEN_URL` | `https://<portal>/api/integrations/oauth/token` |
   | `EXAM_PORTAL_CLIENT_ID` | The `--client-id` used above |
   | `EXAM_PORTAL_CLIENT_SECRET` | The printed secret |
   | `EXAM_PORTAL_STUDENT_UPSERT_URL` | `https://<portal>/api/integrations/v1/students` |
   | `EXAM_PORTAL_LAUNCH_TICKET_URL` | `https://<portal>/api/integrations/v1/launch-tickets` |
   | `EXAM_PORTAL_SCOPE` | `students:write students:launch staff:launch assessments:write results:read` (or a subset) |
   | `EXAM_PORTAL_AUDIENCE` | `exam-portal-api` |

## Token endpoint

`POST /api/integrations/oauth/token`

- Auth: HTTP Basic `base64(urlencode(client_id) + ":" + urlencode(client_secret))`, or `client_id` and `client_secret` in the form body.
- Body (`application/x-www-form-urlencoded`): `grant_type=client_credentials`, optional `scope` (space-separated) and optional `audience` (must be `exam-portal-api`).
- `200` returns `{"access_token": "<token>", "token_type": "Bearer", "expires_in": 3600}`. If the requested scopes were narrowed, `scope` is added with the granted list.
- Errors: `400 invalid_request`, `400 unsupported_grant_type`, `400 invalid_scope` (none of the requested scopes allowed), `401 invalid_client`, `429` (30 requests per minute per IP, or 10 failed attempts per IP + client in 5 minutes).

By default tokens are opaque and stored as SHA-256 hashes along with the client, tenant, scopes, audience and expiry. With the built-in issuer configured (`docs/INTEGRATIONS.md`), they are RS256 JWTs with `expires_in` of 600 instead.

## Calling /api/integrations/v1/*

Each call sends `Authorization: Bearer <token>`: an opaque or built-in JWT token from above, or a JWT from a tenant's own identity provider. Every request body carries `tenant_id`, which must equal the client's tenant. A GET may pass `tenant_id` as a query parameter.

| Status | Meaning |
|---|---|
| `401 invalid_token` | Missing, unknown or expired token. Refresh once and retry. |
| `403 insufficient_scope` | The token lacks the route's scope |
| `403 tenant_mismatch` | `tenant_id` is not the client's tenant |
| `400` / `422` | Malformed JSON, missing `tenant_id` or invalid fields / reused `Idempotency-Key` or an assessment that breaks the portal's rules |
| `413` | The request body is over 1 MB |
| `429` | 600 requests per minute per IP across `/api/integrations/*` |

Error bodies have the shape `{"ok": false, "error": "<code>", "error_description": "<text>", "message": "<text>"}`.

| Route | Scope | Body / query | Success |
|---|---|---|---|
| `POST /v1/students` | `students:write` | `tenant_id, external_student_id, candidate_id, name, email, category, sub_category, status, assigned_assessments[{ums_assessment_id, name, examination}]` + `Idempotency-Key` header | `201` created / `200` updated: `{"ok", "result", "external_student_id", "candidate_id", "status", "assigned_assessments", "unmapped_assessments"}` |
| `POST /v1/launch-tickets` | `students:launch` | `tenant_id, external_student_id` | `200 {"ok", "launch_url", "expires_at", "expires_in"}`; `404` if not provisioned or inactive |
| `POST /v1/staff-launch-tickets` | `staff:launch` | `tenant_id, external_user_id (for example "ums-user:<id>"), name, email` | `200 {"ok", "launch_url", "expires_in"}`; `409 email_conflict`; `403 user_inactive` |
| `PUT /v1/assessments` | `assessments:write` | `tenant_id, external_assessment_id, name, examination, start_date, end_date, total_time, status` | `201` / `200 {"ok", "result", "assessment_id", "external_assessment_id", "status"}` |
| `GET /v1/results` | `results:read` | `?external_assessment_id=…&since=<ISO>` | `200 {"ok", "results": [{external_assessment_id, external_student_id, candidate_id, obtained_mark, negative_mark, total_mark, pass_mark, passed, evaluated_at}]}`; `404` for an unknown assessment |
| `PUT /v1/assessment-mappings` | Administrator session, not a token | `tenant_id, external_assessment_id, assessment_id` | `200 {"ok", "updated_students"}` |

### Behaviour

- **Students** are upserted by `tenant_id` + `external_student_id`, so a repeated call never creates a duplicate. On create, the portal generates the six-digit Candidate ID returned as `candidate_id`. The incoming `candidate_id` is ignored. `status: "inactive"` deactivates the candidate.
- **Assignments.** Each `ums_assessment_id` is matched by an administrator's mapping, then an assessment published with that `external_assessment_id`, then a unique exact name and examination match among unclaimed assessments. Matches are assigned directly; ids with no match are listed in `unmapped_assessments`. The sync replaces only the assignments it made earlier. Assignments made in the portal are never removed. An inactive student loses all UMS-made assignments.
- **Idempotency.** For 24 hours, a repeated `Idempotency-Key` with the same body returns the stored response. The same key with a different body returns `422 idempotency_key_reused`.
- **Assessments.** Questions, sections, marks and the pass mark are authored in the portal and are never overwritten by `PUT`. A new assessment has no sections until an administrator adds them.
- **Results.** Only evaluated results from assessments whose results are published, for students provisioned by UMS in the same tenant. Answers, photos and other candidate fields are never included. `since` is inclusive (`evaluated_at >= since`).
- **Launch tickets** are random, single-use, valid for 90 seconds and stored hashed. `GET /launch?ticket=…` redeems one ticket, starts the normal portal session (`ums_exam_session` cookie) and redirects `302` to `/dashboard` on the portal origin. A used, expired or unknown ticket returns `401 invalid_ticket`. `GET /api/auth/launch` redeems the same tickets but sends failures to the login page with a message.
- **Staff** launched from UMS get a portal account linked by `external_user_id`, with the role `UMS Academic Staff` and an unusable random password. The session is restricted on the server to authoring questions and assessments. An administrator may change the role later, which lifts the restriction; later launches keep it. A deactivated account gets `403 user_inactive`.

## Outbound push from the portal (optional)

The admin page **Settings → Integrations** can push one student to a UMS receiver (`POST /api/integrations/exam-portal`). It reads these portal variables, renamed from `EXAM_PORTAL_*` so names are no longer reversed:

`UMS_TENANT_ID`, `UMS_TOKEN_URL`, `UMS_CLIENT_ID`, `UMS_CLIENT_SECRET`, `UMS_STUDENT_UPSERT_URL`, optional `UMS_SCOPE`, `UMS_AUDIENCE`.

It obtains an opaque client-credentials token. If the UMS receiver requires a JWT that it validates by issuer and JWKS, that token must come from an authorization server that UMS trusts.

## Operations

- Rate limits are kept in memory per server process. With several instances, also limit at the load balancer.
- Each integration call logs one JSON line: `{"event": "integration_call", "client_id", "route", "method", "status", "duration_ms"}`. Tokens, secrets and student data are never logged.
- Tests: `npm test` runs the route suite against an in-memory PostgreSQL (PGlite), then the `node --test` unit suites. Neither connects to `DATABASE_URL`.
