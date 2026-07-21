const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.resolve(__dirname, '..');

test('PG migration export supports GH and Routeup formats without changing export state', () => {
  const server = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
  const start = server.indexOf('async function createAccountApprovalMigrationExportBuffer');
  const end = server.indexOf('async function verifyRouteupBankAccounts', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = server.slice(start, end);

  assert.match(server, /app\.get\('\/api\/admin\/account-approvals\/migration-export\.xlsx'/);
  assert.match(source, /requestedFormat === 'routeup'/);
  assert.match(source, /requestedFormat === 'gh'/);
  assert.match(source, /exportStatus:\s*'all'/);
  assert.match(source, /includeConfigured:\s*true/);
  assert.match(source, /includeAllApproved:\s*true/);
  assert.match(source, /pgProvider:\s*''/);
  assert.match(source, /createAccountApprovalExportWorkbook\(rows,\s*\{\s*format\s*\}\)/);
  assert.doesNotMatch(source, /markAccountApprovalsExported/);
});

test('repository can bypass prior PG credentials and export-ready date for migration only', () => {
  const repository = fs.readFileSync(path.join(rootDir, 'db/repository.js'), 'utf8');
  const filterStart = repository.indexOf('accountApprovalExportFilters(filters = {})');
  const listStart = repository.indexOf('async listAccountApprovalExportRows', filterStart);
  const countStart = repository.indexOf('async countAccountApprovalExportRows', listStart);
  assert.notEqual(filterStart, -1);
  assert.notEqual(listStart, -1);
  assert.notEqual(countStart, -1);

  const filters = repository.slice(filterStart, listStart);
  const list = repository.slice(listStart, countStart);
  assert.match(filters, /filters\.includeConfigured\s*===\s*true/);
  assert.match(list, /filters\.includeAllApproved\s*===\s*true/);
  assert.match(list, /ar\.status = 'APPROVED'/);
  assert.match(list, /da\.account_status = 'APPROVED'/);
});

test('admin PG migration downloads are independent from screen filters and verification export', () => {
  const html = fs.readFileSync(path.join(rootDir, '이츠페이_관리자_시스템_10.html'), 'utf8');
  const start = html.indexOf('async function downloadAllAccountsPgExcel');
  const end = html.indexOf('function getManagedAccount', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = html.slice(start, end);

  assert.match(source, /\/api\/admin\/account-approvals\/migration-export\.xlsx/);
  assert.match(source, /format\s*===\s*'routeup'/);
  assert.match(source, /format\s*===\s*'gh'/);
  assert.doesNotMatch(source, /accountExportFilterQuery|collectAccountFilters|exportApprovedAccounts/);
  assert.match(source, /위루트_가맹점_일괄등록_/);
});

test('migration export response identifies the Routeup file as 위루트', () => {
  const server = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
  const start = server.indexOf('async function sendAccountApprovalMigrationExportWorkbook');
  const end = server.indexOf('async function verifyRouteupBankAccounts', start);
  const source = server.slice(start, end);

  assert.match(source, /위루트_가맹점_일괄등록_/);
  assert.match(source, /filename\*=UTF-8''/);
});

test('Routeup migration upload sends all approved accounts without marking them exported', () => {
  const server = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
  const start = server.indexOf('async function handleRouteupAccountMigrationUpload');
  const end = server.indexOf('async function handleRouteupAccountApprovalUpload', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = server.slice(start, end);

  assert.match(server, /app\.post\('\/api\/admin\/account-approvals\/migration-upload\/routeup'/);
  assert.match(source, /exportStatus:\s*'all'/);
  assert.match(source, /includeConfigured:\s*true/);
  assert.match(source, /includeAllApproved:\s*true/);
  assert.match(source, /buildRouteupMerchantPayloadRows/);
  assert.match(source, /merchandises\/batch-updaters\/register/);
  assert.doesNotMatch(source, /markAccountApprovalsExported/);
});

test('admin exposes GH result upload and all-account Routeup server upload', () => {
  const html = fs.readFileSync(path.join(rootDir, '이츠페이_관리자_시스템_10.html'), 'utf8');
  const accountsModule = fs.readFileSync(path.join(rootDir, 'admin-assets/js/admin-accounts.js'), 'utf8');
  const start = html.indexOf('async function uploadAllApprovedAccountsToRouteup');
  const end = html.indexOf('function getManagedAccount', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = html.slice(start, end);

  assert.match(accountsModule, /id="account-migration-txid-upload"[^>]*data-account-txid-upload-input="1"/);
  assert.match(source, /\/api\/admin\/account-approvals\/migration-upload\/routeup/);
  assert.doesNotMatch(source, /accountExportFilterQuery|collectAccountFilters/);
});
