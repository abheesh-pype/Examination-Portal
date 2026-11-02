# UMS ↔ Exam Portal Integration

The Exam Portal implements the inbound API that the UMS integration client calls. UMS connects by configuration only: create a client on the portal, then set the UMS variables below.

This document contains no live credentials. Hand over client secrets only through an approved secret manager. Never put them in tickets, chat, committed files or screenshots.

## Connecting UMS

1. Deploy the portal on HTTPS and set `PORTAL_PUBLIC_URL` (for example `https://exam.example.edu`). Launch URLs and the post-launch redirect use this origin.
2. Create a client on the portal server. The secret is printed once and only its scrypt hash is stored:

   ```bash
   node scripts/create-integration-client.mjs --client-id ums-prod --tenant-id <agreed-tenant-id>
   # optional: --scopes "students:write students:launch"   (default: all five scopes)
   # rotate:   --rotate   (issues a new secret and revokes existing tokens)
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

- Auth: HTTP Basic `base64(urlencode(client_id) + ":" + urlencode(client_secret))`.
- Body (`application/x-www-form-urlencoded`): `grant_type=client_credentials`, optional `scope` (space-separated) and optional `audience` (must be `exam-portal-api`).
- `200` returns `{"access_token": "<opaque>", "token_type": "Bearer", "expires_in": 3600}`. If the requested scopes were narrowed, `scope` is added with the granted list.
- Errors: `400 invalid_request`, `400 unsupported_grant_type`, `400 invalid_scope` (none of the requested scopes allowed), `401 invalid_client`, `429` (30 requests per minute per IP).

Tokens are opaque. They are stored as SHA-256 hashes along with the client, tenant, scopes, audience and expiry.

## Calling /api/integrations/v1/*

Each call sends `Authorization: Bearer <token>`. Every request body carries `tenant_id`, which must equal the client's tenant. A GET may pass `tenant_id` as a query parameter.

| Status | Meaning |
|---|---|
| `401 invalid_token` | Missing, unknown or expired token. Refresh once and retry. |
| `403 insufficient_scope` | The token lacks the route's scope |
| `403 tenant_mismatch` | `tenant_id` is not the client's tenant |
| `400` / `422` | Malformed JSON or missing `tenant_id` / invalid fields |
| `429` | 600 requests per minute per IP across `/api/integrations/*` |

Error bodies have the shape `{"ok": false, "error": "<code>", "error_description": "<text>"}`.

| Route | Scope | Body / query | Success |
|---|---|---|---|
| `POST /v1/students` | `students:write` | `tenant_id, external_student_id, candidate_id, name, email, category, sub_category, status, assigned_assessments[{ums_assessment_id, name, examination}]` + `Idempotency-Key` header | `201` created / `200` updated: `{"ok", "external_student_id", "candidate_id", "assigned_assessments", "unmapped_assessments"}` |
| `POST /v1/launch-tickets` | `students:launch` | `tenant_id, external_student_id` | `200 {"ok", "launch_url", "expires_at"}`; `404` if not provisioned or inactive |
| `POST /v1/staff-launch-tickets` | `staff:launch` | `tenant_id, external_user_id ("ums-user:<id>"), name, email` | `200 {"ok", "launch_url"}`; `409 email_conflict`; `403 user_inactive` |
| `PUT /v1/assessments` | `assessments:write` | `tenant_id, external_assessment_id, name, examination, start_date, end_date, total_time, status` | `201` / `200 {"ok", "assessment_id", "external_assessment_id"}` |
| `GET /v1/results` | `results:read` | `?external_assessment_id=…&since=<ISO>` | `200 {"ok", "results": [{external_assessment_id, external_student_id, candidate_id, obtained_mark, negative_mark, total_mark, pass_mark, passed, evaluated_at}]}`; `404` for an unknown assessment |

### Behaviour

- **Students** are upserted by `tenant_id` + `external_student_id`, so a repeated call never creates a duplicate. On create, the portal generates the six-digit Candidate ID returned as `candidate_id`. The incoming `candidate_id` is ignored. `status: "inactive"` deactivates the candidate.
- **Assignments.** Each `ums_assessment_id` is matched against an assessment published with that `external_assessment_id`. Matches are assigned directly; ids with no match are listed in `unmapped_assessments`. The sync replaces only the assignments it made earlier. Assignments made in the portal are never removed. An inactive student loses all UMS-made assignments.
- **Idempotency.** For 24 hours, a repeated `Idempotency-Key` with the same body returns the stored response. The same key with a different body returns `422 idempotency_key_reused`.
- **Assessments.** Questions, sections, marks and the pass mark are authored in the portal and are never overwritten by `PUT`. A new assessment has no sections until an administrator adds them.
- **Results.** Only evaluated results from assessments whose results are published, for students provisioned by UMS in the same tenant. Answers, photos and other candidate fields are never included. `since` is inclusive (`evaluated_at >= since`).
- **Launch tickets** are random, single-use, valid for 90 seconds and stored hashed. `GET /launch?ticket=…` redeems one ticket, starts the normal portal session (`ums_exam_session` cookie) and redirects `302` to `/dashboard` on the portal origin. A used, expired or unknown ticket returns `401 invalid_ticket`.
- **Staff** launched from UMS get a portal account linked by `external_user_id`, with the role `UMS Staff` (not an administrator) and an unusable random password. An administrator may change the role later; later launches keep it.

## Outbound push from the portal (optional)

The admin page **Settings → Integrations** can push one student to a UMS receiver (`POST /api/integrations/exam-portal`). It reads these portal variables, renamed from `EXAM_PORTAL_*` so names are no longer reversed:

`UMS_TENANT_ID`, `UMS_TOKEN_URL`, `UMS_CLIENT_ID`, `UMS_CLIENT_SECRET`, `UMS_STUDENT_UPSERT_URL`, optional `UMS_SCOPE`, `UMS_AUDIENCE`.

It obtains an opaque client-credentials token. If the UMS receiver requires a JWT that it validates by issuer and JWKS, that token must come from an authorization server that UMS trusts.

## Operations

- Rate limits are kept in memory per server process. With several instances, also limit at the load balancer.
- Each integration call logs one JSON line: `{"event": "integration_call", "client_id", "route", "method", "status", "duration_ms"}`. Tokens, secrets and student data are never logged.
- Tests: `npm test` runs the integration suite against an in-memory PostgreSQL (PGlite). It never connects to `DATABASE_URL`.
