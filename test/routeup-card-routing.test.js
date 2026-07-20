const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('Routeup billing helpers build document-compatible card registration and payment payloads', () => {
  const {
    buildRouteupBillKeyPayload,
    buildRouteupBillPayPayload,
    extractRouteupBillKey,
    isRouteupSuccess
  } = require('../lib/routeup-payments');

  const contract = {
    mid: 'M233207',
    tid: '4026070013',
    paymentKey: 'routeup-pay-key'
  };

  assert.deepEqual(buildRouteupBillKeyPayload({
    contract,
    orderNo: 'CARD-1',
    buyerName: 'Buyer',
    buyerPhone: '01012345678',
    cardNumber: '4111-1111-1111-1111',
    expiryMonth: '09',
    expiryYear: '25',
    identity: '900101',
    cardPw: '12'
  }), {
    mid: 'M233207',
    tid: '4026070013',
    ord_num: 'CARD-1',
    buyer_name: 'Buyer',
    buyer_phone: '01012345678',
    card_num: '4111111111111111',
    yymm: '2509',
    auth_num: '900101',
    card_pw: '12'
  });

  assert.deepEqual(buildRouteupBillPayPayload({
    contract,
    orderNo: 'TXN-1',
    buyerName: 'Buyer',
    buyerPhone: '01012345678',
    itemName: 'eats PAY 충전',
    billKey: 'bill-key-1',
    amount: 1046,
    installment: 0
  }), {
    mid: 'M233207',
    tid: '4026070013',
    ord_num: 'TXN-1',
    buyer_name: 'Buyer',
    buyer_phone: '01012345678',
    item_name: 'eats PAY 충전',
    bill_key: 'bill-key-1',
    installment: '00',
    amount: 1046
  });

  assert.equal(extractRouteupBillKey({ result_cd: '0000', bill_key: 'bill-key-1' }), 'bill-key-1');
  assert.equal(isRouteupSuccess({ result_cd: '0000' }), true);
  assert.equal(isRouteupSuccess({ result_cd: '1001' }), false);
});

test('server keeps card registration and payment on GH while account credentials follow the selected PG', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const cardStart = server.indexOf("app.post('/api/card/register'");
  const cardEnd = server.indexOf("app.post('/api/admin/accounts/reset-verification'", cardStart);
  const chargeStart = server.indexOf("app.post('/api/payment/charge'");
  const chargeEnd = server.indexOf("app.get('/api/payment/history'", chargeStart);

  assert.ok(cardStart > 0 && cardEnd > cardStart, 'card register route not found');
  assert.ok(chargeStart > 0 && chargeEnd > chargeStart, 'payment charge route not found');

  const cardRoute = server.slice(cardStart, cardEnd);
  const chargeRoute = server.slice(chargeStart, chargeEnd);

  assert.doesNotMatch(cardRoute, /routeupRequest\('\/api\/v2\/pay\/bill-key'/);
  assert.match(cardRoute, /ghPaymentsRequest\('\/api\/billing\/reg'/);
  assert.match(cardRoute, /cardVerificationPgProvider/);
  assert.match(cardRoute, /provider:\s*'GH_PAYMENTS'/);

  assert.doesNotMatch(chargeRoute, /routeupRequest\('\/api\/v2\/pay\/bill-key\/hand'/);
  assert.doesNotMatch(chargeRoute, /CARD_PG_RE_REGISTRATION_REQUIRED/);
  assert.match(chargeRoute, /currentPgBillingCredentials\(depositAccount, selectedPgProvider\)/);
  assert.match(chargeRoute, /ghPaymentsRequest\('\/api\/billing\/pay'/);
  assert.match(chargeRoute, /pg:\s*billingCredentials\.providerName/);
});

test('web treats complete Routeup external keys as approved charge account credentials', () => {
  for (const file of ['js/app.js', 'www/js/app.js']) {
    const js = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(js, /function hasRouteupExternalKeysForVaccount/, `${file}: Routeup external key helper missing`);
    assert.match(js, /function hasVaccountApprovalCredentials/, `${file}: approval credential helper missing`);
    assert.match(js, /hasVaccountTidKey\(account\) \|\| hasRouteupExternalKeysForVaccount\(account\)/, `${file}: Routeup external keys should count for approval`);
    assert.match(js, /const hasCredentials = hasVaccountApprovalCredentials\(account\)/, `${file}: charge account filter should use approval credentials`);
    assert.match(js, /account\?\.currentPgApproved/, `${file}: current PG approval should override generic account credentials`);
  }
});

test('card list and account API keep cards provider-independent and expose current PG approval', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const cardListStart = server.indexOf("app.get('/api/card/list'");
  const cardListEnd = server.indexOf("app.put('/api/card/:id'", cardListStart);
  const accountStart = server.indexOf("app.get('/api/franchise/accounts'");
  const accountEnd = server.indexOf("app.patch('/api/franchise/accounts/:id/active'", accountStart);
  const cardListRoute = server.slice(cardListStart, cardListEnd);
  const accountRoute = server.slice(accountStart, accountEnd);

  assert.doesNotMatch(cardListRoute, /cardMatchesCurrentPg/);
  assert.match(cardListRoute, /repo\.listCardsByUserId\(req\.user\.id\)/);
  assert.match(accountRoute, /currentPgApproved:\s*accountMatchesCurrentPgApproval/);
  assert.doesNotMatch(accountRoute, /map\(\(\{ currentPgApproved, \.\.\.item \}\) => item\)/);
});

test('Routeup account visibility requires both Routeup approval keys and billable TID credentials', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const start = server.indexOf('function accountHasCurrentPgApprovalCredentials');
  const end = server.indexOf('function accountMatchesCurrentPgApproval', start);
  const helper = server.slice(start, end);

  assert.match(helper, /hasRouteupExternalIntegrationKeys\(providerScopedAccount\)/);
  assert.match(helper, /currentPgBillingCredentials\(providerScopedAccount, selectedPgProvider\)/);
});

test('changing a franchise PG preserves registered GH cards', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const adminFile = fs.readdirSync(root).find(file => file.includes('관리자') && file.endsWith('.html'));
  const html = fs.readFileSync(path.join(root, adminFile), 'utf8');
  const updateStart = server.indexOf("app.put('/api/admin/franchises/:id'");
  const updateEnd = server.indexOf("app.patch('/api/admin/franchises/:id/note'", updateStart);
  const updateRoute = server.slice(updateStart, updateEnd);

  assert.doesNotMatch(updateRoute, /deactivateCardsByFranchiseId/);
  assert.match(updateRoute, /cardRegistrationPreserved\s*=\s*true/);
  assert.doesNotMatch(html, /기존 등록 카드는 사용할 수 없어/);
  assert.match(html, /등록 카드는 유지되고 계좌·TID만 현재 PG 승인값을 따릅니다/);
});

test('admin Routeup external key save does not reuse legacy GH account TID', () => {
  const adminFile = fs.readdirSync(root).find(file => file.includes('관리자') && file.endsWith('.html'));
  assert.ok(adminFile, 'admin html file not found');
  const html = fs.readFileSync(path.join(root, adminFile), 'utf8');

  assert.match(html, /savedHasPaymentKey\?saved\.tid:''/, 'Routeup draft should keep saved TID only when a payment key exists');
  assert.match(html, /txid:c\.tid\|\|''/, 'Routeup external key payload should not fall back to legacy txid');
  assert.match(html, /tid:c\.tid\|\|''/, 'Routeup contract TID should not fall back to legacy txid');
  assert.doesNotMatch(html, /tid:c\.tid\|\|account\.txid/, 'Routeup contract TID must not reuse GH txid');
});

test('web keeps Routeup provider card error message before generic mapping', () => {
  for (const file of ['js/app.js', 'www/js/app.js']) {
    const js = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(js, /ROUTEUP_CARD_REGISTRATION_FAILED/, `${file}: Routeup card error code missing`);
    assert.match(js, /ROUTEUP_PROVIDER_MESSAGE_CODES/, `${file}: provider message priority set missing`);
    assert.match(js, /ROUTEUP_PROVIDER_MESSAGE_CODES\.has\(code\)[\s\S]*return raw/, `${file}: Routeup provider message should be returned before generic text`);
  }
});

test('web card form uses numeric keypads for numeric card fields', () => {
  for (const file of ['index.html', 'www/index.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    for (const id of ['add-card-number', 'add-card-pw', 'add-card-cvc', 'add-card-identity', 'add-card-payer-tel']) {
      const match = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`, 'i'));
      assert.ok(match, `${file}: ${id} input missing`);
      assert.match(match[0], /inputmode="numeric"/, `${file}: ${id} should use numeric keypad`);
      assert.match(match[0], /pattern="\[0-9/, `${file}: ${id} should advertise numeric pattern`);
    }
  }
});
