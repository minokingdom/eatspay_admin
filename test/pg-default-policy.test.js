const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isHeadOfficeAgency,
  selectDefaultPgProvider
} = require('../lib/pg-default-policy');

const providers = [
  { id: 2, name: 'GH Payments', status: '활성', displayOrder: 1 },
  { id: 5, name: '위루트', status: '활성', displayOrder: 2 }
];

test('direct signup default agency and HQ signup link default to Routeup', () => {
  assert.equal(isHeadOfficeAgency({ type: 'HQ', name: '이츠페이 본사' }), true);
  assert.equal(selectDefaultPgProvider(providers, { type: 'HQ', name: '이츠페이 본사' }).name, '위루트');
  assert.equal(selectDefaultPgProvider(providers, { joinCode: 'EATSPAY-HQ' }).name, '위루트');
});

test('branch and office signup links always default to GH Payments', () => {
  assert.equal(selectDefaultPgProvider(providers, { type: 'BRANCH', joinCode: 'anyang' }).name, 'GH Payments');
  assert.equal(selectDefaultPgProvider(providers, { type: 'OFFICE', joinCode: 'office-1' }).name, 'GH Payments');
  assert.equal(selectDefaultPgProvider(providers, {
    type: 'BRANCH',
    name: '본사 직영 안양지사',
    joinCode: 'EATSPAY-HQ'
  }).name, 'GH Payments');
  assert.equal(selectDefaultPgProvider(providers, {
    type: 'OFFICE',
    name: '본사 상담 지점'
  }).name, 'GH Payments');
  assert.equal(selectDefaultPgProvider(providers, null).name, 'GH Payments');
});

test('inactive preferred provider falls back to the first active provider', () => {
  const fallback = selectDefaultPgProvider([
    { id: 2, name: 'GH Payments', status: '비활성', displayOrder: 1 },
    { id: 5, name: '위루트', status: '활성', displayOrder: 2 }
  ], { type: 'BRANCH' });
  assert.equal(fallback.name, '위루트');
});
