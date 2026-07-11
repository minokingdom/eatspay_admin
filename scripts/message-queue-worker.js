'use strict';

const { createPool } = require('../db/pool');
const { createRepository } = require('../db/repository');

const pool = createPool();
const repo = createRepository(pool);
const batchSize = Math.min(Math.max(Number(process.env.MESSAGE_QUEUE_BATCH_SIZE || 20), 1), 100);
const leaseSeconds = Math.min(Math.max(Number(process.env.MESSAGE_QUEUE_LEASE_SECONDS || 60), 15), 600);
const retryDelays = [5000, 30000, 120000];
const baseUrl = String(process.env.MESSAGE_QUEUE_INTERNAL_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const secret = String(process.env.MESSAGE_QUEUE_WORKER_SECRET || '');
let stopping = false;

async function deliver(job, delivery) {
  if (!secret) throw new Error('MESSAGE_QUEUE_WORKER_SECRET is required');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}/api/internal/message-jobs/deliver`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-message-worker-secret': secret },
      body: JSON.stringify({ jobId: job.id, deliveryId: delivery.id }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`delivery endpoint ${response.status}`);
  } finally { clearTimeout(timer); }
}

async function processOne() {
  await repo.recoverStaleMessageJobs();
  const job = await repo.claimMessageJob(leaseSeconds);
  if (!job) return false;
  const deliveries = await repo.listPendingMessageDeliveries(job.id, batchSize);
  for (const delivery of deliveries) {
    if (stopping) break;
    try {
      await deliver(job, delivery);
      await repo.completeMessageDelivery(delivery.id);
    } catch (error) {
      await repo.failMessageDelivery(delivery.id, error?.message || error);
    }
  }
  const attempt = Math.min(Math.max(Number(job.attempt_count || 1) - 1, 0), retryDelays.length - 1);
  await repo.finishMessageJob(job.id, retryDelays[attempt]);
  return true;
}

async function main() {
  while (!stopping) {
    const worked = await processOne().catch(error => {
      console.error('[message-queue-worker]', error?.message || error);
      return false;
    });
    if (!worked) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await pool.end();
}

process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { processOne, retryDelays };
