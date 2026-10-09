# Examination Portal — Project Analysis and Handoff

**Review date:** 2 October 2026  
**Audience:** Managers, stakeholders, developers, and future AI coding assistants  
**Review scope:** Repository structure, implemented workflows, API and persistence design, and the current UI implementation. This is a codebase review, not a formal security audit or live-browser acceptance test.

## 1. Executive overview

This repository contains **ums.exam**, a web-based examination administration portal. It is built with Next.js App Router, React, TypeScript, and PostgreSQL. Administrators can configure question and candidate data, create assessment definitions, manage users and roles, and make several types of manual assessment assignments. The student portal now includes a camera-gated exam-taking interface with assessment question delivery and temporary in-browser answer selection.

The project is beyond a static dashboard: much of the administration experience is database-backed and the manual candidate, evaluator, and invigilator assignment workflows persist through API routes. The student portal can now present a timed exam UI and keep selected answers temporarily in page memory, but it does not save exam attempts or answers. This is **not yet a complete online examination system**: durable answer submission, automatic/manual marking workflows, results, operational reporting, and audit history are not implemented. Some assessment menu entries and candidate-list controls are still presentation-only.

**Management summary:** Treat the project as an **examination administration prototype/foundation**. Do not deploy it for real candidate or staff data until authentication, API authorization, account provisioning, data protection, operational controls, and the outstanding product workflows have been addressed.

## 2. What the product is

The application is intended to help an institution prepare and administer examination data:

- Maintain a categorized question bank.
- Configure question classifications and assessment/examination types.
- Configure candidate categories, subcategories, and candidate data fields.
- Register/import candidate records.
- Define assessments, their scheduling/configuration, and section rules.
- Assign candidate subcategories to assessments.
- Assign individual candidates to evaluator and invigilator users.
- Manage users, roles, and UI permission settings.

The current product boundary is **administrative setup and assignment**, not assessment delivery. Assessment configuration and an assessment preview should not be mistaken for a published exam or a live candidate attempt.

## 3. Implemented feature inventory

| Area | Implemented behavior | Important boundary or limitation |
|---|---|---|
| Login and student exam | Landing screen offers Organization and Student portals. Organization login calls `POST /api/users/login`; session-like user state is restored from browser local storage. Student login calls `POST /api/candidates/login` and validates Candidate ID plus the configured date-of-birth field (`DOB`, `Date of Birth`, or `Birth Date`); successful sign-in opens a student dashboard with Exam Schedule. Exam rows show Upcoming Examination before the start, Attend Exam from the start until the earlier of the end time or configured Last Login Time (minutes after start), and Exam is not attend after the allowed window. Attend Exam requests camera permission, captures a selfie and an ID photo locally, then calls `POST /api/candidates/student-exam` to revalidate credentials, cohort assignment, and the allowed time window and load active matching questions without their answer keys. Before enabling the camera, the candidate must consent to live viewing by authorized staff; the notice explains that the feed is not recorded/stored and ends with the exam or staff feed. The exam screen renders configured sections, supported answer controls, a countdown, an examination overview, and browser-local answer selection. Students can move forward sequentially, cannot navigate back to already-passed questions, and see Submit Exam on the final question; that action ends the local session. During the exam, an in-browser MediaPipe detector counts stable no-face, one-face (OK), and multiple-face events. Counts for these checks, camera track interruptions, tab changes, and full-screen exits are published from the candidate's browser to the database every five seconds. The assessment's Invigilate view aggregates live counts across all cohort-assigned candidates for administrators; invigilators see only their individually assigned candidates. Both roles can expand each event type to view per-candidate counts; panels refresh every five seconds. Authorized staff can request a consented live camera connection from a candidate row; the camera stream is peer-to-peer WebRTC, while short-lived offer/answer/ICE signaling is relayed by `POST /api/candidates/student-exam/live-feed`. The feed can be ended by either side and is not recorded or persisted. Alerts are shown for no face, multiple faces, camera interruption, tab changes, and full-screen exits. Microphone access is not requested. The detector runtime/model are downloaded from public CDN/model servers, while face-detection frames are analyzed in-browser. Candidate settings ensure a required Date of Birth field exists for new candidate records. Current candidate records were populated with the shared dummy DOB `2000-01-01` for testing. New and reset organization passwords are stored using scrypt hashes; sign-in remains compatible with existing legacy plaintext password records. | Exam answers and photos are not persisted or uploaded; Submit Exam only ends the local page session and does not save or submit answers to the portal. The ID photo is not verified. A live feed, when the candidate consents and an authorized staff member requests it, is transmitted to that viewer and can expose personal information in the camera frame; no video recording/storage is implemented. Live connectivity uses a public STUN server and can fail behind restrictive NAT/firewalls; a separately provisioned TURN relay may be needed for reliable production service. SDP/ICE signaling is temporarily held in PostgreSQL while a feed is active; stale signaling data is eligible for pruning after two minutes on a subsequent signaling write. Face detection depends on network access to fetch the model/runtime and can be affected by lighting, camera quality, or occlusion; it detects faces, not identity, and does not constitute proctoring. Proctor counts are transient live telemetry with a 30-second stale-session timeout, not a durable attempt record or institutional audit log. The APIs use the portal's current Candidate ID/DOB and local-storage user identity patterns; implement server-issued sessions and authorization before production. Browser security prevents the portal from reliably blocking application/tab switching; visibility/full-screen changes only trigger warnings/counting in this page session, and the before-unload prompt can be bypassed. Motion alerts use sampled camera-frame changes; they do not identify a person. Attendance/attempt tracking is not available, so the missed label reflects expiry of the login window, not verified attendance. Replace the shared dummy DOB with each candidate's verified date of birth before real use. Candidate ID and date of birth are a basic credential, not a strong password; use a server-issued candidate authentication flow before production. |
| Dashboard | Examination Workspace hero, welcome message, permission-filtered module shortcuts, header module search, responsive shell, profile menu/logout. | Notification icon is visual only; there is no notification feed. |
| Navigation | Collapsible navy sidebar, nested Settings and Users navigation, role-permission filtering, tooltip-style compact mode, hover/scroll expansion and auto-collapse. | Navigation gating is client-side and must not be treated as API authorization. |
| Questions | Add/edit/delete, table search and paging, active/inactive status toggle, question-type details, CSV/XLSX import and downloadable template. Supported types include single/multiple choice, fill-in-the-blank, true/false, yes/no, agree/disagree, good/bad, manual evaluation, and passage type. Student exam delivery selects active questions matching the assessment classifications and configured question types/counts. | Import accepts up to 1,000 rows per request. Exam attempts and answers are not stored, and no marking/results workflow is implemented. |
| Question settings | CRUD for categories, subcategories, topics, difficulty levels, and languages; active status controls where provided. | These are reference data used by question forms and filters. |
| Assessments | Create/edit/delete assessment definitions; grid/list view; schedule and classification fields; sections and question-count/mark/difficulty settings; CSV/XLSX import; question preview. Wrong marks must be zero or negative. | Import accepts up to 500 rows. The “assigned questions” card figure is currently derived from the configured question count, not from a persisted question assignment. |
| Assessment preview | Fetches questions and filters them by the assessment’s category, subcategory, topic, and language; displays questions in sections and renders options when present. | Read-only preview; it does not select or freeze questions for delivery. |
| Candidate assignment | Assessment menu → Assign Candidates → Manual selects/removes candidate subcategories (cohort assignment). Upload imports up to 1,000 Candidate ID rows from an Excel template or CSV and assigns only those active candidates to the selected assessment. Individual assignments are stored separately from cohort assignments, and assigned candidates can access the assessment from their student dashboard. | Manual cohort assignment continues to include every candidate in the selected subcategory. |
| Evaluator assignment | Assessment menu → Assign Evaluator → Manual assigns selected candidates; Upload imports Candidate ID / Evaluator Email rows from an Excel template or CSV for the selected assessment. Upload validates active candidates and active evaluator accounts, then adds or updates assignments for only the listed candidates. | Assignments are per assessment and candidate. |
| Results | Admin Results lists assessments and evaluated candidate scores. Admins can publish each assessment's results; student Results shows evaluated scores only for assessments marked as published. | Publishing is assessment-wide and cannot currently be undone from the UI. |
| Invigilator assignment | Assessment menu → Assign Invigilator → Manual assigns selected candidates; Upload imports Candidate ID / Invigilator Email rows from an Excel template or CSV for the selected assessment. Upload validates active candidates and active invigilator accounts, then adds or updates assignments for only the listed candidates. | Assignments are per assessment and candidate. This does not provide an invigilation session/monitoring tool. |
| Invigilation view | Assessment menu → Invigilate opens Live Activity and Candidates views. Activity categories are expandable and intentionally empty; Candidates lists each candidate assigned to an invigilator for this assessment, shows the invigilator's name, displays available assessment details, and offers View Timeline, View Live Feed, and Restart Exam actions. | Exam attempts, actual start times, live activity events, and attendance statuses are not stored yet. Actions therefore explain that their data/operation is unavailable; restart does not change candidate data. |
| Candidates | Add candidate using configured fields; import candidates by CSV/XLSX; display candidate ID, date of birth, other candidate fields, category, subcategory, and status. Candidate IDs are assigned by the server as unique six-digit numbers for manual creation and imports. Existing candidate records are backfilled once, preserving valid unique IDs and replacing missing, invalid, or duplicate values. A required Date of Birth field is ensured for new records. Student dashboard schedules active assessments assigned to the candidate's category/subcategory. | Existing records currently have the shared dummy DOB `2000-01-01`; replace with verified dates before real use. The Candidates table labels missing dates “Not provided.” Candidate table search/page-size controls are present but are not wired to filtering or pagination; Previous/Next are disabled. Candidate edit/delete are not implemented in the visible candidate flow/API. |
| Candidate field settings | Configure field name/type, required status, status, numeric limits, dropdown options, and dependency metadata. Built-in field types include text, number, dropdown, date, and email. | Dependency behavior and validation should be verified against the intended business rules before relying on complex dependent-field setups. |
| Candidate categories | Create/edit/delete categories and subcategories; subcategories are associated with categories. | Candidate record validation is stronger during import than in some manual UI paths; confirm all required validation server-side. |
| Users | List users from the database; add, edit, and delete users; toggle account status; and reset a user's password after matching “Enter Password” and “Re-enter Password” fields. The user's email remains the login ID. Inactive users cannot log in and are excluded from evaluator/invigilator assignment dropdowns. | New accounts require a temporary password and should use the reset flow before deployment. |
| Roles & permissions | Create/edit roles and configure dashboard/module actions in a permission matrix. Role permission data is stored as JSONB. | Role API has no delete endpoint. UI permissions do not secure API routes. |
| Settings placeholders | Navigation includes assessment defaults and organization settings. | These destinations currently render the generic placeholder rather than a settings workflow. |

## 4. User workflows

### Typical administrative setup

1. Configure PostgreSQL and set `DATABASE_URL` in the local or deployment environment.
2. Start the Next.js application and sign in.
3. Configure examination types and question reference data (categories, subcategories, topics, difficulty levels, and languages).
4. Create questions manually or download the question template and import CSV/XLSX.
5. Configure candidate categories/subcategories and candidate data fields.
6. Add candidate records manually or import the candidate template generated from active candidate fields.
7. Create an assessment, set its examination type, name, dates/times, question filters, and sections.
8. Preview matching questions. This is a read-only preview, not a published exam.
9. Assign candidate subcategories to the assessment when using cohort-based assignment.
10. Use the separate evaluator and invigilator manual assignment screens to associate individual candidates with users of those roles.
11. Configure users and role permissions for the administrative UI.

### Assignment persistence behavior

- Candidate-subcategory assignments are stored separately from staff assignments.
- Evaluator and invigilator mappings each use their own assignment table. Saving a staff assignment replaces the set of assignments for that assessment with the submitted set; removing a candidate saves the remaining set.
- The staff assignment screen filters candidate records by the selected candidate category and subcategory, and the staff dropdown filters active user records by normalized role name.
- No workflow in this repository turns these assignments into candidate exam sessions or evaluation/invigilation work queues.

## 5. UI and user-experience analysis

### Current design

The interface is a desktop-first administration dashboard with responsive behavior for narrower layouts:

- Sticky white header with ums.exam branding, sidebar toggle, searchable module navigation, notification glyph, and profile/logout menu.
- Dark navy/purple compact sidebar that expands on interaction and contains role-filtered navigation.
- Soft lavender/purple “Examination Workspace” hero with an academic illustration.
- Dashboard shortcut cards use pastel accent colors, rounded corners, borders, and hover movement.
- The 13 dashboard module cards cover Questions, Assessments, Candidates, Users, Question Categories, Question Sub Categories, Question Topics, Difficulty Levels, Languages, Examinations, Candidate Categories, Candidate Sub Categories, and Candidate Settings; visibility follows role permissions.
- Management areas use tables, forms, modal/overlay dialogs, tabs, and consistent purple primary actions.
- Assessment cards support grid/list presentation and a three-dot contextual menu.
- Assignment modals use category/subcategory filters, candidate tables and selection, staff selectors, and assigned-candidate tabs.
- Styles include tablet/mobile breakpoints, and the sidebar overlays content on small screens.

### UI strengths

- The dashboard design is more cohesive and examination-specific than a generic admin template.
- Existing dashboard modules are retained and access-filtered using the role’s configured permissions.
- The assignment screens expose the important distinction between available and already assigned records.
- Import dialogs provide templates and display row-level validation errors returned by the API.
- Several dialogs support Escape/outside-click dismissal and include accessible labels/roles.

### UI issues to prioritize

1. **Inactive affordances are misleading:** assessment menu entries `Upload`, `Settings`, `Invigilate`, `Evaluate`, and `Reports` do not currently launch working features.
2. **Candidate table controls imply behavior they do not have:** search/page-size selectors do not filter the rows, and pagination buttons are disabled.
3. **Some assessment summary values are placeholders:** candidate count and total marks are initialized to `"0"`; assigned-question count repeats the configured section question total rather than reporting persisted question assignments.
4. **Notification control is decorative:** there is no notification state, menu, or destination.
5. **Settings placeholder pages remain:** assessment defaults and organization settings are navigable but not implemented.
6. **Accessibility and responsive QA still need formal validation:** source includes responsive CSS and ARIA attributes, but there is no automated browser/accessibility suite in the repository.
7. **Style maintenance is becoming difficult:** `app/globals.css` is a large global stylesheet with base rules followed by later redesign overrides. Consolidating tokens and removing obsolete/duplicate declarations would reduce cascade risk.
8. **UI maintainability is a concern:** most screen components and form workflows live in the single, very large `app/page.tsx` file. Feature-level components/hooks would make changes easier to test and review.

The shared browser pages could not be read during this review because browser CDP connections timed out. UI observations above are based on the source and styles, not a fresh interactive visual acceptance pass.

## 6. Technical architecture

| Layer | Implementation |
|---|---|
| Framework | Next.js 16 App Router |
| UI runtime | React 19 with TypeScript |
| Main route | `/`, rendered from `app/page.tsx`; most UI is a client-side dashboard and local form/modal state. |
| Styles | Tailwind CSS 4 is imported; most visual presentation is custom global CSS in `app/globals.css`. |
| API | Next.js route handlers in `app/api/**/route.ts`. |
| Database | PostgreSQL through `pg`; a shared pool is created in `lib/db.ts` with a maximum of 10 clients. |
| CSV | PapaParse. |
| XLSX | `read-excel-file`; import flows read the first worksheet. Legacy `.xls` is not accepted. |
| Configuration | `DATABASE_URL` is required by `lib/db.ts`. `.env*` is ignored by Git; do not commit database credentials. |

The project has no dedicated domain/service/repository layer. Components call API routes with `fetch`, and route handlers perform SQL directly. Many routes call `CREATE TABLE IF NOT EXISTS` and some call `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` at runtime. There is no versioned migration directory or migration command.

## 7. API catalog

All paths below are same-origin Next.js route handlers. The listed methods describe the current handlers, not a promise that every API is authenticated.

| API path | Methods | Purpose |
|---|---|---|
| `/api/users/login` | POST | Check email/password and return user data. |
| `/api/users` | GET, POST, PUT, PATCH, DELETE | List/create/delete users; update profile fields with PUT; reset a password with PATCH. |
| `/api/roles` | GET, POST, PUT | List, create, and update role definitions/permissions. |
| `/api/questions` | GET, POST, PATCH, DELETE | List/create/bulk-create, edit or status-toggle, and delete questions. |
| `/api/question-categories` | GET, POST, PATCH, DELETE | Question category reference data. |
| `/api/question-sub-categories` | GET, POST, PATCH, DELETE | Question subcategory reference data. |
| `/api/question-topics` | GET, POST, PATCH, DELETE | Question topic reference data. |
| `/api/difficulty-levels` | GET, POST, PATCH, DELETE | Difficulty reference data. |
| `/api/languages` | GET, POST, PATCH, DELETE | Language reference data. |
| `/api/assessment-types` | GET, POST, PATCH, DELETE | Examination/assessment type reference data. |
| `/api/assessments` | GET, POST, PATCH, DELETE | Assessment CRUD and bulk import. |
| `/api/assessment-candidate-assignments` | GET, PUT | Read/replace candidate-subcategory assignments for an assessment. |
| `/api/assessment-evaluator-assignments` | GET, PUT | Read/replace per-candidate evaluator assignments. |
| `/api/assessment-invigilator-assignments` | GET, PUT | Read/replace per-candidate invigilator assignments. |
| `/api/assessment-invigilate-candidates` | GET | List candidates assigned to invigilators for an assessment for the invigilation Candidates view. |
| `/api/candidates` | GET, POST | List/create candidates and bulk-import candidates. |
| `/api/candidate-info` | GET, POST, PATCH, DELETE | Configure candidate field metadata. |
| `/api/candidate-info-types` | GET | Return seeded candidate field-type choices. |
| `/api/candidate-categories` | GET, POST, PATCH, DELETE | Candidate category reference data. |
| `/api/candidate-sub-categories` | GET, POST, PATCH, DELETE | Candidate subcategory reference data. |

Question, assessment, and candidate bulk operations validate incoming rows and use database transactions for batch writes. Questions and candidates accept at most 1,000 records per request; assessments accept at most 500. The application-side import templates and server-side validation should be treated as a pair: keep column names and validation rules synchronized.

## 8. Main data model

The schema is defined in route code rather than a separately versioned schema:

- `users`: account identity, role string, password value, active/verified flags, and contact fields.
- `roles`: role name, administrator/dashboard flags, JSONB permissions.
- `questions`: question type/text, optional classification fields, JSONB `details`, status, creation timestamp.
- `assessment`: examination/name, schedule/time settings, classification filters, JSONB `sections`, status, creation timestamp.
- `"Candidate Information"`: a shared table containing both candidate-field definitions and candidate rows, differentiated by `record_type`; candidate values and category/subcategory live in JSONB `candidate_data`.
- Reference tables include `question_category`, `question_sub_category`, `question_topics`, `"Difficulty_level"`, `"Language"`, `"Assessment_Type"`, `candidate_category`, `candidate_sub_category`, and candidate field-type metadata.
- Assignment tables: `assessment_candidate_sub_category`, `assessment_candidate_evaluator`, and `assessment_candidate_invigilator`.

Flexible JSON/JSONB values are useful for configurable sections, permissions, question options/answers, and candidate fields. The tradeoff is weaker schema-level enforcement and more validation responsibility in application code. Several entities use display strings instead of relational foreign keys, and runtime schema setup can drift between endpoints.

## 9. Security, reliability, and product gaps

These are code-review observations; no exploit testing was performed.

### Blockers before real users or sensitive records

1. **Legacy plaintext passwords remain supported.** New and reset passwords are scrypt-hashed, and login verifies those hashes while retaining compatibility with existing plaintext records. Migrate or require resets for legacy records and remove plaintext fallback afterward.
2. **Unsafe account defaults exist.** First-user bootstrapping and user creation use predictable hard-coded credentials/default password behavior. Replace with one-time secure provisioning and invitation.
3. **No server-side authenticated session is established.** The UI stores a user object in `localStorage`; this is client-controlled and does not prove identity to the server.
4. **API endpoints do not enforce identity/role permissions.** UI permission checks only hide navigation/actions. API routes can be requested directly unless protected elsewhere outside this repository.
5. **Sensitive user data exposure needs review.** The user-list API returns email/mobile and has no authorization check in the route.

### Reliability and maintainability

- Add schema migrations and a documented initial database setup. Keep schema creation out of ordinary request paths.
- Cache successful schema initialization for assessment and staff-assignment endpoints per server process, use assignment/result lookup indexes, run independent assessment reads concurrently, and resolve staff sessions/roles in one database query. Other endpoints still perform request-time schema checks and should migrate to versioned database migrations before high-volume deployment.
- Add database uniqueness/foreign-key/check constraints for domain rules where required; candidate category/name and similar duplicate behavior should be explicitly decided.
- Improve consistent input validation and error handling on all CRUD routes, including manual candidate form paths.
- Batch import behavior is transactional, but add automated tests for validation, rollback, duplicate handling, and transaction-safe assignment replacement.
- Split the page into feature components and API/data-access helpers without changing behavior.
- Add structured logging/monitoring, database backup/restore procedures, deployment secrets management, and request limits.
- Define required data retention, privacy, consent, and audit requirements before storing real candidate data.

### Product capabilities still required for a complete exam platform

- Candidate account lifecycle and secure candidate authentication.
- Exam publication/access rules and candidate start/attempt lifecycle.
- Question selection/snapshotting for an assessment; delivery UI; timers and autosave.
- Answer storage, submission/finalization, and attempt history.
- Automatic scoring plus manual-evaluation queues and evaluator rubric/workflows.
- Invigilator session/monitoring workflows.
- Admin results workflow that lists assessments, opens per-assessment evaluated candidate results, and exports results; analytics and broader operational reports remain future work.
- Audit trails and administrative activity history.
- Complete assessment settings, upload-based assignment, organization settings, and notification workflows if those menu entries are intended product features.

## 10. Development and validation

### Local development

1. Install Node.js/npm compatible with the lockfile and run `npm install`.
2. Configure `DATABASE_URL` in an ignored local environment file or deployment environment. Never add the real value to source control.
3. Start the app with `npm run dev`.
4. Open `http://localhost:3000`.

Package scripts: `dev`, `build`, `start`, and `lint`. There is no test script and no test/spec files were found in the repository inventory.

### Review-time checks (2 October 2026)

- `npm run build` — **passed**, including Next.js production compilation, TypeScript, and static page generation.
- `npm run lint` — **failed** with **35 errors and 2 warnings**. Most reported items are in the large `app/page.tsx`, including explicit `any` types and React hook/state-in-effect rules; ESLint also reports an unused `userRows` value. This is a current baseline and was not fixed as part of this documentation task.
- Automated tests — **not present** in the repository inventory.
- Live browser review — **not completed** because both shared localhost pages timed out when queried through the browser integration.

## 11. Recommended roadmap

### P0 — Secure the application

- Implement password hashing, secure bootstrap, account invitation/reset, and server-side session management.
- Require authentication and authorize each API operation on the server, including role/permission checks.
- Review data exposure, CSRF/CORS policy, rate limits, secrets, and production database privileges.

### P1 — Make existing screens truthful and complete

- Wire candidate search/page size/pagination or remove the controls until supported.
- Replace placeholder assessment counts with real assignment/mark data, or label them accurately.
- Wire or clearly mark unavailable assessment actions; implement upload-based assignments if required.
- Add candidate update/deactivation/deletion workflows and consistent validation where business requirements permit.
- Complete assessment default and organization settings if they are in scope.

### P2 — Make the schema and code maintainable

- Add versioned migrations and database setup documentation.
- Extract feature components from `app/page.tsx`; consolidate global CSS and responsive rules.
- Add typed API/domain models and consistent request/response validation.
- Replace remaining `any` types and resolve the lint baseline.

### P3 — Complete the examination lifecycle

- Implement durable exam attempts and answer submission, scoring, manual review, invigilation, results, reporting, and audit history. Current exam selections are in-memory only.
- Implement and test those workflows end-to-end before describing the product as a complete online examination platform.

## 12. Quick handoff context for a future AI assistant

> This is the ums.exam Examination Portal: a Next.js App Router + React + TypeScript application backed by PostgreSQL (`pg`). The main UI and most feature components are currently in `app/page.tsx`; global styling is in `app/globals.css`; route handlers are in `app/api/**/route.ts`; the shared database pool is `lib/db.ts`. Existing features include question CRUD/import and reference data; assessment CRUD/import, section configuration, question preview and student question delivery; candidate custom-field configuration and candidate add/import; role/user administration; candidate-subcategory assignment; and separate per-candidate evaluator/invigilator assignments. The student exam UI requires camera permission, takes local selfie/ID photos, and keeps answer selections only in page memory; no image upload, durable attempt, answer submission, grading, results, or operational reporting exists. CSV/XLSX imports are transactional and have row limits. Some assessment actions and candidate-table controls are placeholders. Before production, secure password storage/account provisioning, establish server-side sessions and API authorization, add persisted attempt/submission flows and migrations/tests, and resolve misleading/inactive controls. Preserve unrelated user work, do not inspect or commit secrets, and maintain existing workflows unless the request explicitly authorizes behavior changes.

## Important repository locations

- Main application UI: [`app/page.tsx`](./app/page.tsx)
- Global styles and responsive design: [`app/globals.css`](./app/globals.css)
- Database pool: [`lib/db.ts`](./lib/db.ts)
- API handlers: [`app/api/`](./app/api)
- Package scripts/dependencies: [`package.json`](./package.json)
- Sample candidate import file: [`sample-candidate-upload.csv`](./sample-candidate-upload.csv)
