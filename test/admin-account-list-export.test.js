const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');

function loadAccountsModule() {
  const code = fs.readFileSync(path.join(rootDir, 'admin-assets/js/admin-accounts.js'), 'utf8');
  const context = { window: { EatsAdminAccounts: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'admin-accounts.js' });
  return context.window.EatsAdminAccounts;
}

test('account list excel rows include pending, approved, and rejected accounts', () => {
  const accounts = loadAccountsModule();
  const franchises = [{
    id: 101,
    name: '전체상태가맹점',
    customerId: 'all-status-user',
    owner: '홍길동',
    pgProviderName: 'GH Payments',
    deliveryAgencies: [
      { id: 1, agency: '배달사A', accountStatus: '승인대기', bankName: '신한은행', accountNo: '1111', accountHolder: '홍길동', reqDate: '2026-07-01' },
      { id: 2, agency: '배달사B', accountStatus: '승인완료', bankName: '국민은행', accountNo: '2222', accountHolder: '홍길동', reqDate: '2026-07-02', exportReadyAt: '2026-07-03' },
      { id: 3, agency: '배달사C', accountStatus: '반려', bankName: '우리은행', accountNo: '3333', accountHolder: '홍길동', reqDate: '2026-07-04' }
    ]
  }];

  const filtered = accounts.filterAccountRows(franchises, {});
  const rows = accounts.buildAccountListExportRows(filtered);

  assert.equal(rows.length, 3);
  assert.deepEqual(Array.from(rows, row => row.status), ['승인대기', '승인완료', '반려']);
  assert.deepEqual(Array.from(rows, row => row.accountNo), ['1111', '2222', '3333']);
  assert.ok(rows.every(row => row.pgProvider === 'GH Payments'));
});

test('account list download ignores screen filters and exports every account', () => {
  const html = fs.readFileSync(path.join(rootDir, '이츠페이_관리자_시스템_10.html'), 'utf8');
  const start = html.indexOf('async function downloadAllAccountsExcel');
  const end = html.indexOf('function getManagedAccount', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = html.slice(start, end);

  assert.match(source, /filterAccountRows\(D\.franchises,\{\}\)/);
  assert.match(source, /buildAccountListExportRows/);
  assert.match(source, /\/api\/admin\/exports\/settlement\.xlsx/);
  assert.match(source, /name:'출금계좌 목록'/);
  assert.doesNotMatch(source, /collectAccountFilters|getVerifiedAccounts|accountVerifiedForExport|exportApprovedAccounts|exportStatus/);
});
