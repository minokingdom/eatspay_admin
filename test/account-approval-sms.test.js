const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const repository = fs.readFileSync(path.join(root, 'db', 'repository.js'), 'utf8');

test('final account approval queues the requested owner SMS once', () => {
  assert.match(server, /const ACCOUNT_APPROVAL_SMS_MESSAGE = \[/);
  for (const line of [
    '사장님',
    '지금부터 이츠페이',
    '모든 서비스 이용이 가능합니다.',
    '항상 응원하겠습니다.',
    '감사합니다.'
  ]) assert.match(server, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(server, /function accountApprovalSmsJobId\(/);
  assert.match(server, /type:\s*'ACCOUNT_APPROVAL_SMS'/);
  assert.match(server, /channel:\s*'sms'/);
  assert.match(server, /await enqueueAccountApprovalSms\(source, id, userId\)/);
  assert.match(repository, /ON CONFLICT \(id\) DO UPDATE SET id = EXCLUDED\.id/);
});

test('manual PG contract activation also queues the approval SMS on transition', () => {
  const routeStart = server.indexOf("app.put('/api/admin/accounts/pg-contracts'");
  const routeEnd = server.indexOf("app.get('/api/admin/account-rejection-reasons'", routeStart);
  const route = server.slice(routeStart, routeEnd);
  assert.match(route, /wasServiceEnabled/);
  assert.match(route, /isServiceEnabled/);
  assert.match(route, /enqueueAccountApprovalSms/);
});

test('message delivery supports SMS and promotes long Korean text to LMS', () => {
  assert.match(server, /delivery\.channel === 'sms'/);
  assert.match(server, /await sendAligoSms\(user\.phone, job\.body/);
  assert.match(server, /Buffer\.byteLength\(message, 'utf8'\) > 90 \? 'LMS' : 'SMS'/);
  assert.match(server, /msg_type:\s*messageType/);
});
