const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repository = fs.readFileSync(path.resolve(__dirname, '..', 'db', 'repository.js'), 'utf8');

test('settlement list prefers real transfer time and falls back to CH PAYWAY confirmation receipt time', () => {
  assert.match(
    repository,
    /row\.transfer_received_at \|\| row\.deposit_received_at \|\| row\.settlement_confirmed_at \|\| row\.settled_at/
  );
  assert.match(repository, /cn\.received_at AS settlement_confirmed_at/);
  assert.match(repository, /event_type = 'CH_PAYWAY_FALLBACK_SETTLED'/);
  assert.match(repository, /transaction_id = ps\.approval_no/);
  assert.match(repository, /pn\.query->>'acctNo'/);
  assert.match(repository, /ps_match\.account_no/);
  assert.match(repository, /pn\.received_at <= t\.created_at \+ interval '24 hours'/);
});

test('GH transfer success replaces only a CH PAYWAY date-only midnight settlement time', () => {
  assert.match(repository, /ps\.settled_at IS NULL\s+OR\s+\(/);
  assert.match(
    repository,
    /ps\.settled_at = date_trunc\('day', ps\.settled_at AT TIME ZONE 'Asia\/Seoul'\) AT TIME ZONE 'Asia\/Seoul'/
  );
  assert.match(repository, /fallback_notification\.event_type = 'CH_PAYWAY_FALLBACK_SETTLED'/);
  assert.match(repository, /fallback_notification\.transaction_id = ps\.approval_no/);
  assert.match(repository, /ps\.status IN \('NORMAL_APPROVED', 'PENDING', 'APPROVED', 'SETTLED'\)/);
});
