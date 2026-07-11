const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('account modal offers OCR only when an image proof and account number exist', () => {
  const code = fs.readFileSync(path.join(root, 'admin-assets/js/admin-accounts.js'), 'utf8');
  const context = { window: { EatsAdminAccounts: {}, EatsAdminAccountUtils: { proofZoomButton: () => '<button>proof</button>' } } };
  vm.createContext(context);
  vm.runInContext(code, context);
  const modal = context.window.EatsAdminAccounts.renderAccountDetailModal({
    franchise: { id: 1, name: '테스트 가맹점' },
    account: { accountNo: '56216975432139', bankName: '신한은행', documentUrl: '/uploads/proof.jpg', fileName: 'proof.jpg' },
    fid: 1,
    idx: 0
  }, { role: 'hq' });
  assert.match(modal.body, /data-admin-action="account-proof-ocr"/);
  assert.match(modal.body, /data-proof-document-url="\/uploads\/proof.jpg"/);
  assert.match(modal.body, /data-proof-account-no="56216975432139"/);
  assert.match(modal.body, /data-account-proof-ocr-result/);
});

test('admin HTML posts OCR request and renders every terminal state', () => {
  const html = fs.readFileSync(path.join(root, '이츠페이_관리자_시스템_10.html'), 'utf8');
  assert.match(html, /function runAccountProofOcr/);
  assert.match(html, /\/api\/admin\/accounts\/proof-ocr/);
  assert.match(html, /account-proof-ocr/);
  for (const state of ['matched', 'mismatched', 'not_found', 'loading', 'error']) assert.match(html, new RegExp(state));
  const ocrFunction = html.slice(html.indexOf('function runAccountProofOcr'), html.indexOf('async function approveAccount'));
  assert.doesNotMatch(ocrFunction, /approveAccount\(/);
});
