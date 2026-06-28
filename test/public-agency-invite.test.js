const assert = require('node:assert/strict');
const test = require('node:test');

const { createPublicAgencyInvite } = require('../lib/public-agency-invite');

test('createPublicAgencyInvite exposes only the safe invite fields', () => {
  const invite = createPublicAgencyInvite({
    id: 210,
    name: 'test',
    loginId: 'private-login',
    feeRate: 0.5,
    owner: 'private-owner',
    joinCode: 'JOIN-123'
  });

  assert.deepEqual(invite, {
    agencyId: '210',
    agencyName: 'test',
    joinCode: 'JOIN-123'
  });
});

test('createPublicAgencyInvite returns null when the agency or join code is missing', () => {
  assert.equal(createPublicAgencyInvite(null), null);
  assert.equal(createPublicAgencyInvite({ id: 1, name: 'test' }), null);
});
