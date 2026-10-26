# UMS ↔ Exam Portal Integration Verification

**Purpose:** verified handoff for configuring the UMS sender against the Exam Portal integration currently present in this repository.

## Executive summary

The Exam Portal currently contains an **admin-triggered outbound student sync** at `POST /api/integrations/exam-portal`. It obtains an OAuth 2.0 client-credentials token and posts one student with current active assessment assignments to the configured UMS/partner receiver URL.

The Exam Portal does **not** implement the receiving endpoint proposed below (`POST /api/integrations/v1/students`). That receiver must be built and deployed by the UMS team before a connection can succeed. This repository also does not implement institutional OIDC student sign-in; student login remains Candidate ID + date of birth.

This document contains no live credentials. No client ID, secret, token URL, tenant ID, or production receiver URL is configured as a usable value in the checked-in source. Obtain those values from the relevant deployment and identity-provider administrators through an approved secret-sharing channel.

## Verified UMS sender configuration

The current Exam Portal reads the following server-side environment variables:

| Variable | Required by current code | Source / notes |
|---|---:|---|
| `UMS_TENANT_ID` | Yes | Agreed tenant identifier. Sent as `tenant_id`. |
| `EXAM_PORTAL_TOKEN_URL` | Yes | OAuth token endpoint that accepts this client registration. Must be HTTPS in production. |
| `EXAM_PORTAL_CLIENT_ID` | Yes | Client ID issued by the service operating the token endpoint. |
| `EXAM_PORTAL_CLIENT_SECRET` | Yes | Client secret issued for the UMS backend. Keep only in the server secret manager. |
| `EXAM_PORTAL_STUDENT_UPSERT_URL` | Yes | Full URL of the UMS receiving endpoint. Must be HTTPS in production. The suggested path is not currently implemented by this Exam Portal. |
| `EXAM_PORTAL_SCOPE` | No | Optional. If set, sent as a form field to the token endpoint. |
| `EXAM_PORTAL_AUDIENCE` | No | Optional. If set, sent as a form field to the token endpoint. |

Use this template in the **UMS server's** secret manager after the UMS team has implemented the receiver:

```dotenv
UMS_TENANT_ID=<agreed-tenant-id>
EXAM_PORTAL_TOKEN_URL=https://<authorization-server-host>/<confirmed-token-path>
EXAM_PORTAL_CLIENT_ID=<client-id-issued-for-ums>
EXAM_PORTAL_CLIENT_SECRET=<secret-issued-for-ums>
EXAM_PORTAL_STUDENT_UPSERT_URL=https://<ums-host>/<confirmed-receiver-path>
EXAM_PORTAL_SCOPE=<confirmed-scope-if-required>
EXAM_PORTAL_AUDIENCE=<confirmed-audience-if-required>
```

Do not use `NEXT_PUBLIC_*`, `VITE_*`, source files, browser storage, or an APK for these values. Do not put actual secrets in tickets, chat, Markdown committed to a repository, or screenshots.

### Environment variables not consumed by this Exam Portal

The following names in the supplied checklist are **not read by the current Exam Portal code**:

- `EXAM_PORTAL_SEND_IDEMPOTENCY_KEY`
- `EXAM_PORTAL_TIMEOUT_MS`

The sender currently **always** sends an `Idempotency-Key` header, computed as the SHA-256 digest of the JSON payload. It uses a 10-second timeout for token acquisition and a 15-second timeout for the student upsert. These values are hard-coded; there is no environment-based timeout setting.

## Verified authentication and token contract

The current Exam Portal sends the token request as:

- `POST` to `EXAM_PORTAL_TOKEN_URL`
- HTTP Basic authentication with `EXAM_PORTAL_CLIENT_ID:EXAM_PORTAL_CLIENT_SECRET`
- `Content-Type: application/x-www-form-urlencoded`
- Form field `grant_type=client_credentials`
- Optional form fields `scope` and `audience` when configured

The token response must be JSON containing:

```json
{
  "access_token": "<opaque bearer token>",
  "token_type": "Bearer"
}
```

`token_type` is compared case-insensitively. `expires_in` is **not required or validated** by the current sender. An authorization server may include `expires_in`, but it is not currently part of this sender's acceptance check.

The UMS receiver must validate the bearer token according to the authorization server's documented trust model, including issuer, audience, expiry, and required scope/permissions. Confirm whether the token endpoint is operated by the Exam Portal or the institution's identity provider, and ensure that the UMS client is registered at that same authorization server. Do not assume any OIDC identity provider automatically issues client-credentials tokens accepted by the UMS receiver.

## Verified receiver request contract

The receiver URL is configurable. The Exam Portal guide proposes:

```text
POST https://<ums-host>/api/integrations/v1/students
```

That path is a **proposal only** and is not implemented as an inbound endpoint in this Exam Portal repository. The UMS team must confirm the deployed URL and implement a compatible receiver, or provide its actual endpoint and schema so the Exam Portal can be changed separately.

The Exam Portal sends:

```http
Authorization: Bearer <access token>
Content-Type: application/json
Accept: application/json
Idempotency-Key: <SHA-256 hex digest of JSON payload>
```

Example payload based on current sender behavior:

```json
{
  "tenant_id": "<configured UMS_TENANT_ID>",
  "external_student_id": "123456",
  "candidate_id": "123456",
  "name": "Example Student",
  "email": "student@example.edu",
  "category": "Undergraduate",
  "sub_category": "Year 1",
  "status": "active",
  "assigned_assessments": [
    {
      "ums_assessment_id": 42,
      "name": "Midterm Mathematics",
      "examination": "Semester 1"
    }
  ]
}
```

### Field and ID corrections

- `candidate_id` is the student's **six-digit Candidate ID** as stored in the Exam Portal. The current sender does not accept an arbitrary enrollment number unless that number is actually the same six-digit Candidate ID.
- `external_student_id` currently uses that same six-digit Candidate ID. UMS must agree to use that value as its stable external identity or request a coordinated change to the sender and receiver contract.
- `ums_assessment_id` is currently emitted as a **JSON number** (`Number(assessment.id)`), not a UUID string. The current `assessment.id` is a numeric database ID. A receiver requiring UUID strings needs a coordinated schema/mapping change; do not silently coerce it.
- `name`, `email`, `category`, and `sub_category` are strings; email is `null` when the Exam Portal candidate record has no email.
- `status` is `"active"` or `"inactive"` from the candidate record's active status.
- `assigned_assessments` contains active assessments assigned directly to the candidate or through their active category/subcategory. Its elements currently contain the numeric UMS-local `ums_assessment_id`, assessment `name`, and `examination`.
- Password and date of birth are not included in this payload.

## Success, failures, and retry behavior

The current sender treats **any HTTP 2xx** from the receiver as success. It does not parse or validate the receiver's JSON response. Therefore, the checklist statements that it requires a JSON object and rejects `error`, `success: false`, or `ok: false` are **incorrect for the current Exam Portal implementation**.

The UMS receiver should return an unambiguous success status and JSON response, for example:

```json
{
  "ok": true,
  "external_student_id": "123456"
}
```

However, until the Exam Portal sender is changed to inspect the body, a 2xx response containing `{"ok": false}` will still be reported as synced. For reliable behavior, coordinate an update to the Exam Portal sender to validate the response body before treating the sync as successful.

The current sender reports non-2xx token/upsert responses and network errors as failures; network timeouts are bounded. It does **not** automatically retry 429 or 5xx responses. The UMS must not assume automatic retry exists. Add safe retries only with receiver-supported idempotency semantics, bounded attempts, and backoff.

### Inactive students and assignment revocation

The current sender transmits an inactive student's `"status": "inactive"`, but it still calculates and includes any matching active assessment assignments. It does **not** force `assigned_assessments` to an empty list for inactive candidates.

The UMS receiver must define how inactive status affects access and assignments. If the requirement is to clear assignments on deactivation, either:

1. Make the receiver revoke access and assignments whenever `status` is `"inactive"`, regardless of the supplied assignment list; or
2. Coordinate a sender change to send an empty list for inactive candidates.

Do not assume revocation occurs until this behavior has been implemented and tested in the UMS.

## Student login and SSO blocker

The Exam Portal's current student login requires Candidate ID plus date of birth. Institutional OIDC login with Authorization Code + PKCE and account linking by `(iss, sub)` is **not implemented in this repository**. No DOB or student password is sent during provisioning.

Consequently, successful provisioning alone does not enable an OIDC-only student to sign in. Before release, choose and implement one coordinated authentication solution:

- Implement institutional OIDC in the Exam Portal and map the verified issuer + subject to the provisioned tenant + external student ID; or
- Agree on another secure authentication design that does not use DOB as a secret.

The Exam Portal does not currently operate as an OIDC provider. The institution's identity provider must be configured in the Exam Portal for student SSO.

## Values the UMS team must provide

These values belong to the UMS deployment owner and cannot be inferred from this repository:

1. Public HTTPS base URL for the UMS deployment.
2. Exact inbound student-upsert URL/path to implement.
3. Agreed tenant ID.
4. UMS receiver's required OAuth token issuer, audience, scope, and client-authentication policy.
5. Stable identifier rule, confirming whether the UMS will store the six-digit Candidate ID as `external_student_id`.
6. Whether the UMS receiver accepts numeric assessment IDs or needs a coordinated UUID mapping.
7. Success response format, duplicate/idempotency semantics, inactive-user behavior, and retry rules.
8. Whether the UMS will implement institutional OIDC account linking or require a different student sign-in contract.

## Values the Exam Portal team must provide

The Exam Portal/authorization-server operator must issue or confirm:

1. OAuth token URL.
2. Client ID and client secret for the UMS backend, created with least-privilege student-provisioning scope.
3. Required scope and audience values, if applicable.
4. The confirmed UMS receiver URL and supported payload version.
5. Token format/issuer and how the UMS receiver validates signature, issuer, audience, expiry, and scope.
6. Confirmation that the receiver accepts Basic client authentication and `grant_type=client_credentials`.
7. Agreed SSO issuer/client/callback setup for students, if institutional OIDC is the selected login method.

Exchange client secrets only through an approved secret manager or secure channel. Never put them in this file.

## Verification checklist before production

- [ ] UMS receiver is deployed at the exact HTTPS URL configured in `EXAM_PORTAL_STUDENT_UPSERT_URL`.
- [ ] A least-privilege OAuth client is issued and credentials are installed only server-side.
- [ ] Token request accepts HTTP Basic client authentication and the expected form fields.
- [ ] Receiver validates issuer, audience, scope, expiry, tenant, and payload schema.
- [ ] Candidate identity and assessment ID formats are agreed and tested without coercion.
- [ ] Duplicate posts are idempotent and the receiver's handling of `Idempotency-Key` is verified.
- [ ] Inactive student access and assignment revocation behavior is verified.
- [ ] Receiver returns a successful status and response body; sender response validation is upgraded if required.
- [ ] Network timeout, 401, 403, 429, 5xx, duplicate delivery, and recovery behavior are tested.
- [ ] Institutional OIDC student sign-in works end-to-end, or another approved login design is available.
- [ ] No DOB, password, client secret, or access token appears in request logs, browser bundles, APKs, or repository files.

## Source files verified

- Outbound sender and OAuth handling: `app/api/integrations/exam-portal/route.ts`
- Admin guide, payload example, and server variable names: `app/integration-guide.tsx`
- Current student login behavior: `app/api/candidates/login/route.ts`
- Candidate ID and DOB-based student authorization: `lib/auth.ts`
