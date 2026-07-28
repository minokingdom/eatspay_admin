const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');

test('TID upload response records the remaining exported validation count', () => {
  assert.match(server, /countAccountApprovalExportRows\(\{\s*exportStatus: 'exported'\s*\}\)/);
  assert.match(server, /remainingValidationCount/);
});

test('internal Kakao TID uploads append the same durable upload event as web uploads', () => {
  assert.match(
    server,
    /app\.post\('\/api\/internal\/kakao\/account-approvals\/txid-upload'[\s\S]{0,500}recordKakaoTidUploadEvent\s*=\s*true/
  );
  assert.match(server, /if \(req\.recordKakaoTidUploadEvent === true\)[\s\S]{0,500}appendKakaoTidUploadEvent/);
});

test('TID upload keeps the complete hyphenated export batch id', () => {
  assert.match(server, /\(ACCEXP-\[A-Za-z0-9-\]\+\)/);
});

test('the admin approval endpoint emits a queue-drained event after either account source is processed', () => {
  assert.match(server, /async function appendKakaoApprovalQueueDrainedEventIfNeeded/);
  assert.match(server, /kind:\s*'approval_queue_drained'/);
  assert.match(server, /pendingVerificationCount[^]*pendingExportRows\.length/);
  const endpoint = server.match(/app\.post\('\/api\/admin\/accounts\/approve'[^]*?\n\}\)\);/)?.[0] || '';
  assert.equal((endpoint.match(/appendKakaoApprovalQueueDrainedEventIfNeeded\(\)/g) || []).length, 2);
});

test('Kakao TID events are replaced atomically instead of overwriting a possibly read-only file', () => {
  assert.match(server, /function writeKakaoTidUploadEvents\(events\)/);
  assert.match(server, /renameSync\(temporaryPath, KAKAO_TID_UPLOAD_EVENTS_PATH\)/);
  assert.equal((server.match(/writeKakaoTidUploadEvents\(events\);/g) || []).length, 2);
  assert.doesNotMatch(
    server,
    /writeFileSync\(KAKAO_TID_UPLOAD_EVENTS_PATH, JSON\.stringify\(events\.slice\(-200\), null, 2\)\)/
  );
});
