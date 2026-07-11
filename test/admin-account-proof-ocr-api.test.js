const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');

test('server exposes an authenticated account proof OCR endpoint', () => {
  assert.match(server, /require\('\.\/lib\/account-proof-ocr'\)/);
  assert.match(server, /app\.post\('\/api\/admin\/accounts\/proof-ocr', authenticateAdmin, asyncHandler/);
});

test('OCR endpoint validates account number and upload path without approving accounts', () => {
  const start = server.indexOf("app.post('/api/admin/accounts/proof-ocr'");
  const end = server.indexOf("}));", start) + 4;
  assert.ok(start >= 0 && end > start);
  const route = server.slice(start, end);
  assert.match(route, /normalizeOcrAccountNo/);
  assert.match(route, /resolveProofImagePath/);
  assert.match(route, /assertProofImageExists/);
  assert.match(route, /recognizeAccountProof/);
  assert.match(route, /OCR_BUSY/);
  assert.doesNotMatch(route, /approve|updateAccount|ACCOUNT_APPROVE/i);
});
