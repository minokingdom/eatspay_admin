# Admin Message Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move administrator bulk push announcements into a durable PostgreSQL queue with restart recovery, retries, deduplication, and an admin monitoring screen.

**Architecture:** The API transaction creates one `message_jobs` row plus immutable `message_job_deliveries` target rows and returns HTTP 202. A separate Node worker claims jobs with `FOR UPDATE SKIP LOCKED`, processes recipients in bounded batches, and records progress. Existing FCM delivery is extracted into a shared module used by the API and worker.

**Tech Stack:** Node.js 22, Express 4, PostgreSQL/pg, Node test runner, systemd, existing single-file admin UI and admin modules.

---

### Task 1: Queue schema and repository contract

**Files:**
- Modify: `db/schema.sql`
- Modify: `server.js`
- Modify: `db/repository.js`
- Create: `test/message-queue-repository.test.js`

- [ ] **Step 1: Write the failing schema/repository contract tests**

Assert that the schema defines `message_jobs`, `message_job_deliveries`, delivery uniqueness, runnable-job indexes, and lease fields; assert repository methods exist for atomic job creation, listing, detail retrieval, claim, progress, retry, and stale-lease recovery.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/message-queue-repository.test.js`
Expected: FAIL because the tables and methods do not exist.

- [ ] **Step 3: Add the minimal schema and repository methods**

Create jobs with a transaction and target snapshot. Claim with `FOR UPDATE SKIP LOCKED`. Use `(job_id,user_id,channel)` uniqueness and expose camelCase DTOs without tokens or message bodies in list responses.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/message-queue-repository.test.js`
Expected: PASS.

### Task 2: Shared delivery service and worker

**Files:**
- Create: `lib/push-delivery.js`
- Create: `scripts/message-queue-worker.js`
- Create: `test/message-queue-worker.test.js`
- Modify: `server.js`

- [ ] **Step 1: Write failing worker behavior tests**

Cover a 20-recipient batch, continued processing after one recipient fails, three retry schedules, stale lease recovery, and idempotent completed delivery skipping.

- [ ] **Step 2: Run the worker test and verify RED**

Run: `node --test test/message-queue-worker.test.js`
Expected: FAIL because the worker module does not exist.

- [ ] **Step 3: Extract push delivery and implement the minimal worker**

Export reusable FCM delivery functions without starting a server. Worker concurrency defaults to one, batch size to 20, lease to 60 seconds, and retry delays to 5/30/120 seconds. Add request timeouts and graceful SIGTERM handling.

- [ ] **Step 4: Run worker and existing push tests**

Run: `node --test test/message-queue-worker.test.js test/admin-audit-notifications.test.js`
Expected: PASS.

### Task 3: Queue API and asynchronous broadcast submission

**Files:**
- Modify: `server.js`
- Create: `test/admin-message-queue-api.test.js`

- [ ] **Step 1: Write failing API contract tests**

Assert bulk broadcast returns 202 and a job id, list/detail endpoints require system-admin access, retry is restricted to failed jobs, and audit logs are written for creation and retry.

- [ ] **Step 2: Run the API test and verify RED**

Run: `node --test test/admin-message-queue-api.test.js`
Expected: FAIL because queue endpoints and 202 response are absent.

- [ ] **Step 3: Implement API endpoints**

Replace synchronous fan-out in `/api/admin/push/broadcast` with atomic queue creation. Add `/api/admin/message-jobs`, `/api/admin/message-jobs/:id`, `/api/admin/message-jobs/summary`, and `/api/admin/message-jobs/:id/retry`.

- [ ] **Step 4: Run focused API tests**

Run: `node --test test/admin-message-queue-api.test.js`
Expected: PASS.

### Task 4: Administrator queue screen

**Files:**
- Create: `admin-assets/js/admin-message-queue.js`
- Modify: `admin-assets/js/admin-modules.js`
- Modify: `이츠페이_관리자_시스템_10.html`
- Modify: `admin-assets/css/admin-common.css`
- Create: `test/admin-message-queue-ui.test.js`

- [ ] **Step 1: Write failing UI structure tests**

Assert the navigation label, script include, KPI ids, job table, five-second refresh lifecycle, manual refresh, detail action, and failed-only retry action.

- [ ] **Step 2: Run the UI test and verify RED**

Run: `node --test test/admin-message-queue-ui.test.js`
Expected: FAIL because the queue screen is absent.

- [ ] **Step 3: Implement the screen using existing admin classes**

Add the menu after push notifications, four KPI cards, status chips, progress display, fixed-position detail modal content using the existing modal API, and polling that stops when leaving the page.

- [ ] **Step 4: Update broadcast completion UX**

Show “작업이 접수되었습니다” with job id and a button/action to open the queue page; do not claim recipients were already delivered.

- [ ] **Step 5: Run UI tests and guardrails**

Run: `node --test test/admin-message-queue-ui.test.js && npm run check:ui`
Expected: PASS with no new inline styles or direct onclick bindings.

### Task 5: Service unit, deployment, and capacity verification

**Files:**
- Create: `deploy/systemd/eatspay-message-worker.service`
- Create: `scripts/load-test-message-queue.js`
- Modify: `deploy/production.env.example`
- Modify: `docs/web-deployment.md`
- Create: `test/message-queue-deploy.test.js`

- [ ] **Step 1: Write failing deployment contract test**

Assert the systemd unit uses `/opt/eatspay/scripts/message-queue-worker.js`, restarts on failure, and environment examples expose batch, concurrency, lease, and retry controls.

- [ ] **Step 2: Run deployment contract test and verify RED**

Run: `node --test test/message-queue-deploy.test.js`
Expected: FAIL because the unit and variables are absent.

- [ ] **Step 3: Add service, environment documentation, and load harness**

The load harness must target only authenticated read endpoints or a local fixture and report requests/sec, p50, p95, p99, errors, and timeouts for 200 active requests and a 500-request burst.

- [ ] **Step 4: Run complete local verification**

Run: `node --check server.js; node --check scripts/message-queue-worker.js; npm test; npm run check:ui`
Expected: all commands exit 0.

- [ ] **Step 5: Refresh Graphify and inspect impact**

Run: `graphify.cmd update . --no-cluster --force`
Expected: graph update succeeds; inspect affected push and notification flows.

- [ ] **Step 6: Deploy in safe order**

Back up production files, deploy schema/repository/shared service/server, restart and health-check `eatspay`, install/start the worker unit, then deploy admin assets. Do not delete queue tables during rollback.

- [ ] **Step 7: Verify production and run controlled load checks**

Verify both services active, queue API authorization, one test job lifecycle, restart recovery, no duplicate delivery, and compare normal API p95 with and without a queued job. Stop load testing immediately if error rate exceeds 1%, free memory drops below 300MB, or load average exceeds 4 for one minute.
