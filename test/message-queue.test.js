const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('message queue schema is durable, lease based, and idempotent', () => {
  const schema = read('db/schema.sql');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS message_jobs/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS message_job_deliveries/);
  assert.match(schema, /lease_expires_at TIMESTAMPTZ/);
  assert.match(schema, /UNIQUE\s*\(job_id, user_id, channel\)/);
  assert.match(schema, /idx_message_jobs_runnable/);
  assert.match(schema, /message_job_delivery_id BIGINT/);
  assert.match(schema, /idx_notifications_message_delivery/);
});

test('repository exposes atomic queue lifecycle methods', () => {
  const repository = read('db/repository.js');
  for (const method of [
    'createMessageJob', 'listMessageJobs', 'getMessageJob', 'getMessageJobSummary',
    'claimMessageJob', 'listPendingMessageDeliveries', 'completeMessageDelivery',
    'failMessageDelivery', 'finishMessageJob', 'retryMessageJob', 'recoverStaleMessageJobs'
  ]) assert.match(repository, new RegExp(`async ${method}\\b`), `${method} should exist`);
  assert.match(repository, /FOR UPDATE SKIP LOCKED/);
});

test('bulk push submits HTTP 202 jobs and queue APIs are system-admin only', () => {
  const server = read('server.js');
  assert.match(server, /app\.get\('\/api\/admin\/message-jobs'/);
  assert.match(server, /app\.get\('\/api\/admin\/message-jobs\/summary'/);
  assert.match(server, /app\.get\('\/api\/admin\/message-jobs\/:id'/);
  assert.match(server, /app\.post\('\/api\/admin\/message-jobs\/:id\/retry'/);
  assert.match(server, /res\.status\(202\)\.json/);
  assert.match(server, /createMessageJob/);
});

test('message worker has bounded batches, leases, retries, and graceful shutdown', () => {
  const worker = read('scripts/message-queue-worker.js');
  assert.match(worker, /MESSAGE_QUEUE_BATCH_SIZE/);
  assert.match(worker, /MESSAGE_QUEUE_LEASE_SECONDS/);
  assert.match(worker, /\[5000, 30000, 120000\]/);
  assert.match(worker, /recoverStaleMessageJobs/);
  assert.match(worker, /SIGTERM/);
});

test('admin exposes a message queue monitor and queued broadcast result', () => {
  const html = read('이츠페이_관리자_시스템_10.html');
  const module = read('admin-assets/js/admin-message-queue.js');
  assert.match(html, /messageQueue:"메시지 큐"/);
  assert.match(html, /admin-message-queue\.js/);
  assert.match(module, /message-queue-waiting/);
  assert.match(module, /message-queue-running/);
  assert.match(module, /message-queue-completed/);
  assert.match(module, /message-queue-failed/);
  assert.match(module, /5000/);
  assert.match(html, /작업이 접수되었습니다/);
});

test('deployment includes a restartable queue worker service', () => {
  const unit = read('deploy/systemd/eatspay-message-worker.service');
  assert.match(unit, /scripts\/message-queue-worker\.js/);
  assert.match(unit, /Restart=always/);
});
