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
