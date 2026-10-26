"use client";

import { useEffect, useState, type FormEvent } from "react";

type IntegrationStatus = {
  configured: boolean;
  missing: string[];
  endpointHost: string | null;
  error?: string;
};

const proposedStudentPayload = `{
  "tenant_id": "institution-001",
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
}`;

const proposedEnvironment = `UMS_TENANT_ID=institution-001
EXAM_PORTAL_TOKEN_URL=https://exam-portal.example.edu/oauth/token
EXAM_PORTAL_CLIENT_ID=issued-client-id
EXAM_PORTAL_CLIENT_SECRET=store-only-in-server-secret-manager
EXAM_PORTAL_STUDENT_UPSERT_URL=https://exam-portal.example.edu/api/integrations/v1/students
# Optional, when required by the identity provider:
EXAM_PORTAL_SCOPE=students:write
EXAM_PORTAL_AUDIENCE=exam-portal-api`;

export default function IntegrationGuidePanel() {
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/integrations/exam-portal", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as IntegrationStatus;
        if (!response.ok) throw new Error(payload.error ?? "Unable to read integration configuration.");
        setIntegrationStatus(payload);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setIntegrationStatus({
          configured: false,
          missing: [],
          endpointHost: null,
          error: error instanceof Error ? error.message : "Unable to read integration configuration.",
        });
      });
    return () => controller.abort();
  }, []);

  async function provisionStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSyncing(true);
    setSyncError("");
    setSyncMessage("");
    try {
      const response = await fetch("/api/integrations/exam-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });
      const payload = await response.json() as {
        synced?: boolean;
        candidate_id?: string;
        assigned_assessments_count?: number;
        error?: string;
        missing?: string[];
      };
      if (!response.ok) {
        const missing = payload.missing?.length ? ` Missing configuration: ${payload.missing.join(", ")}.` : "";
        throw new Error(`${payload.error ?? "Unable to provision student."}${missing}`);
      }
      setSyncMessage(
        `Candidate ${payload.candidate_id} was sent successfully with ${payload.assigned_assessments_count ?? 0} assigned assessments.`,
      );
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to provision student.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="integration-guide" aria-labelledby="integration-guide-title">
      <header className="integration-guide-heading">
        <p className="section-kicker">Platform configuration</p>
        <h1 id="integration-guide-title">External system integrations</h1>
        <p>
          Provision UMS students and assessment assignments to the standalone Exam Portal
          through a protected server-to-server connection.
        </p>
      </header>

      <section
        className={`integration-guide-status${integrationStatus?.configured ? " is-configured" : ""}${integrationStatus?.error ? " is-error" : ""}`}
        role="status"
        aria-labelledby="integration-guide-status-title"
      >
        <span className="integration-guide-status-dot" aria-hidden="true" />
        <div>
          <h2 id="integration-guide-status-title">
            {integrationStatus === null
              ? "Checking server configuration…"
              : integrationStatus.error
                ? "Unable to read integration configuration"
                : integrationStatus.configured
                  ? "Server configuration is present"
                  : "Integration is not configured"}
          </h2>
          <p>
            {integrationStatus?.error
              ?? (integrationStatus?.configured
                ? `Configuration found for ${integrationStatus.endpointHost}. This checks settings only; use the provisioning action below to verify the remote token and student APIs.`
                : `Set the required server-side variables${integrationStatus?.missing.length ? `: ${integrationStatus.missing.join(", ")}` : ""}. No credentials are entered in this browser.`)}
          </p>
        </div>
      </section>

      <section className="integration-guide-section">
        <h2>Provision a student</h2>
        <p>
          Send one student record and their current active assessment assignments.
          The UMS uses the six-digit Candidate ID for the stable external student ID.
          Passwords and date of birth are never included.
        </p>
        <form className="integration-guide-sync-form" onSubmit={(event) => void provisionStudent(event)}>
          <label htmlFor="integration-candidate-id">Candidate ID</label>
          <div>
            <input
              id="integration-candidate-id"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{6}"
              maxLength={6}
              value={candidateId}
              onChange={(event) => setCandidateId(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="Enter the student’s six-digit ID"
              required
            />
            <button type="submit" disabled={!integrationStatus?.configured || syncing || candidateId.length !== 6}>
              {syncing ? "Sending…" : "Send to Exam Portal"}
            </button>
          </div>
        </form>
        {syncMessage && <p className="integration-guide-success" role="status">{syncMessage}</p>}
        {syncError && <p className="integration-guide-error" role="alert">{syncError}</p>}
      </section>

      <section className="integration-guide-section">
        <h2>Recommended architecture</h2>
        <p>
          Students authenticate to the Exam Portal through the selected institutional
          OIDC identity provider using Authorization Code + PKCE. Separately, UMS uses
          OAuth 2.0 client credentials to provision records to the Exam Portal API.
        </p>
        <div className="integration-guide-flow" aria-label="Recommended integration flow">
          <div><strong>Student</strong><span>Browser or APK</span></div>
          <b aria-hidden="true">→</b>
          <div><strong>Institution IdP</strong><span>Exam Portal SSO, OIDC + PKCE</span></div>
          <b aria-hidden="true">→</b>
          <div><strong>Exam Portal</strong><span>Validates student identity</span></div>
          <b aria-hidden="true">←</b>
          <div><strong>UMS</strong><span>OAuth-protected enrollment sync</span></div>
        </div>
        <p className="integration-guide-note">
          The identity provider authenticates the student directly for the Exam Portal.
          UMS does not currently act as an OIDC provider or participate in the student
          sign-in redirect. UMS student login remains Candidate ID + DOB.
        </p>
      </section>

      <section className="integration-guide-section">
        <h2>Configuration to agree before connecting</h2>
        <div className="integration-guide-grid">
          <article>
            <h3>Identity / SSO</h3>
            <ul>
              <li>Issuer URL and discovery document URL</li>
              <li>Client ID, exact redirect URI, and allowed post-logout URI</li>
              <li>Audience, scopes, and required claims</li>
              <li>Stable student key: token issuer + subject (`iss` + `sub`)</li>
            </ul>
          </article>
          <article>
            <h3>Backend data exchange</h3>
            <ul>
              <li>UMS and Exam Portal HTTPS base URLs</li>
              <li>Registered client ID, secret, token URL, audience, and scopes</li>
              <li>Data ownership, field mapping, and sync direction</li>
              <li>Webhook destination, signature method, and retry policy</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="integration-guide-section">
        <h2>Proposed deployment variables</h2>
        <p>
          Configure these on the UMS server deployment or secret manager, then restart
          the service. Never put secret values in browser storage, APKs, source control, or
          <code> NEXT_PUBLIC_*</code> variables.
        </p>
        <pre className="integration-guide-code"><code>{proposedEnvironment}</code></pre>
        <p className="integration-guide-note">
          UMS checks configuration without returning secrets to the browser. Use a unique
          tenant identifier and OAuth client credentials issued by the Exam Portal.
          For multiple institutions, deploy isolated credentials per tenant; a shared
          client secret across institutions is not appropriate.
        </p>
      </section>

      <section className="integration-guide-section">
        <h2>Student provisioning contract</h2>
        <p>
          The UMS posts the versioned upsert contract below with an OAuth bearer token
          and a deterministic idempotency key. The receiving Exam Portal must implement
          this endpoint and treat repeat requests as updates rather than duplicate students.
        </p>
        <pre className="integration-guide-code"><code>{`POST https://exam-portal.example.edu/api/integrations/v1/students
Authorization: Bearer [short-lived OAuth access token]
Idempotency-Key: [SHA-256 payload digest]
Content-Type: application/json

${proposedStudentPayload}`}</code></pre>
        <p className="integration-guide-note">
          The Exam Portal must validate the issuer, audience and required scope, reject
          replayed or malformed requests, and upsert on <code>tenant_id</code> +
          <code> external_student_id</code>. Assessment IDs are UMS-local identifiers.
          Do not include a student password or date of birth in provisioning payloads.
        </p>
      </section>

      <section className="integration-guide-section">
        <h2>Implementation sequence</h2>
        <ol className="integration-guide-steps">
          <li><strong>Register the Exam Portal with the institutional IdP.</strong> Configure the issuer, client ID, callback URI, scopes, PKCE, and stable subject mapping in the Exam Portal.</li>
          <li><strong>Configure UMS server credentials.</strong> Set the tenant ID, OAuth token endpoint, client ID/secret, upsert URL, and optional scope/audience in the UMS deployment secret store.</li>
          <li><strong>Implement the receiving upsert endpoint.</strong> Validate OAuth issuer, audience and scope; upsert using tenant + external student ID; enforce tenant isolation and idempotency.</li>
          <li><strong>Use the admin provisioning action.</strong> Send and verify one student, including assignment data and deactivation state, before enabling bulk or automatic synchronization.</li>
          <li><strong>Plan reliable synchronization.</strong> Add an outbox, retry/backoff, audit status, and scheduled reconciliation before making sync automatic or high-volume.</li>
          <li><strong>Test before production.</strong> Verify token expiry, wrong-audience rejection, duplicate updates, inactive students, secret rotation, timeouts, and recovery after outages.</li>
        </ol>
      </section>

      <section className="integration-guide-security">
        <h2>Security requirements</h2>
        <ul>
          <li>Never use DOB as an API secret or as the long-term student password.</li>
          <li>Never embed OAuth client secrets or privileged API keys in the APK.</li>
          <li>Require HTTPS, least-privilege scopes, short token lifetimes, and key rotation.</li>
          <li>Validate tenant ownership on every request and minimize student data retained.</li>
          <li>Sign webhooks, check timestamps, reject replays, and log security-relevant events.</li>
        </ul>
      </section>

      <p className="integration-guide-current-login">
        The admin-triggered provisioning flow is available once its server configuration
        is supplied. Automatic/background sync, result return-to-UMS, and OIDC login
        inside UMS are not implemented.
      </p>
    </section>
  );
}
