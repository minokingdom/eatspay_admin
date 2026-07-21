const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');

function functionBody(name) {
  const start = server.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} not found`);
  const next = server.indexOf('\nfunction ', start + 10);
  return server.slice(start, next === -1 ? server.length : next);
}

function loadRouteupMerchantPassword(defaultPassword = '') {
  const body = functionBody('routeupMerchantPassword');
  return new Function('ROUTEUP_MERCHANT_DEFAULT_PW', `${body}; return routeupMerchantPassword;`)(defaultPassword);
}

test('Routeup merchant export uses Routeup 37-column upload template headers', () => {
  assert.match(server, /ROUTEUP_MERCHANT_UPLOAD_COLUMNS/);
  const columnBlockStart = server.indexOf('const ROUTEUP_MERCHANT_UPLOAD_COLUMNS');
  const columnBlockEnd = server.indexOf('];', columnBlockStart);
  const columnBlock = server.slice(columnBlockStart, columnBlockEnd);
  const expectedHeaders = [
    '본사 상호(X)', '본사 수수료(X)', '에이전시 상호(X)', '에이전시 수수료(X)',
    '지사 상호(X)', '지사 수수료(X)', '총판 상호(X)', '총판 수수료(X)',
    '대리점 상호(X)', '대리점 수수료(X)', '영업자 상호(X)', '영업자 수수료(X)',
    '가맹점 ID(O)', '가맹점 패스워드(O)', '가맹점 수수료(X)', '유보금 수수료(X)',
    '상호(O)', '가맹점 명(X)', '대표자명(X)', '이메일(X)', '주소(X)', '휴대폰번호(X)',
    '주민등록번호(X)', '사업자등록번호(X)', '법인등록번호(X)', '가맹점 연락처(X)',
    'GMID(X)', '메모사항(X)', '업종(X)', '구분(X)', '계좌번호(X)', '예금주(X)',
    '은행코드(O)', '사업자 유형(X)', '커스텀 필터(X)', '입금자 타입(X)', '출금 수수료(X)'
  ];
  for (const header of expectedHeaders) {
    assert.match(columnBlock, new RegExp(header.replace(/[()]/g, '\\$&')));
  }
});

test('Routeup validation keeps the password column mandatory', () => {
  const body = functionBody('validateRouteupMerchantPayload');
  assert.match(body, /가맹점 ID가 없습니다/);
  assert.match(body, /가맹점 패스워드가 없습니다/);
  assert.match(body, /상호가 없습니다/);
  assert.match(body, /은행코드를 찾지 못했습니다/);
});

test('Routeup merchant password is stable and valid without a configured default', () => {
  const passwordFor = loadRouteupMerchantPassword();
  const merchant = {
    id: 'FR-17',
    owner_phone: '010-1234-5678',
    account_no: '110-123-456789',
    business_number: '123-45-67890'
  };
  const first = passwordFor(merchant, 0);
  const reordered = passwordFor(merchant, 999);
  const emptyFirst = passwordFor({}, 0);
  const emptyReordered = passwordFor({}, 999);
  assert.equal(first, reordered);
  assert.match(first, /^Ep[0-9A-Za-z]{4,6}!$/);
  assert.equal(emptyFirst, emptyReordered);
  assert.match(emptyFirst, /^Ep[0-9A-Za-z]{4,6}!$/);
});

test('Routeup export and direct upload build the same required password field', () => {
  const exportBody = functionBody('createRouteupAccountApprovalExportWorkbook');
  const migrationStart = server.indexOf('async function handleRouteupAccountMigrationUpload');
  const migrationEnd = server.indexOf('async function handleRouteupAccountApprovalUpload', migrationStart);
  const migrationBody = server.slice(migrationStart, migrationEnd);
  assert.match(exportBody, /buildRouteupMerchantPayloadRows\(rows\)/);
  assert.match(migrationBody, /const payloadRows = buildRouteupMerchantPayloadRows\(rows\)/);
  assert.match(migrationBody, /validateRouteupMerchantPayload\(payloadRows\)/);
  assert.match(migrationBody, /body:\s*payloadRows/);
});
