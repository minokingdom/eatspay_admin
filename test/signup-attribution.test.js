const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createSignupAttribution
} = require('../lib/signup-attribution');

test('createSignupAttribution freezes agency link signup source separately from current agency', () => {
  assert.deepEqual(createSignupAttribution({
    source: 'agency_link',
    agency: { id: 210, joinCode: 'JOIN-210' },
    defaultAgency: { id: 130, joinCode: 'avicx' }
  }), {
    agencyId: 210,
    signupSource: 'agency_link',
    signupAgencyId: 210,
    signupJoinCode: 'JOIN-210'
  });
});

test('createSignupAttribution records direct default signup separately', () => {
  assert.deepEqual(createSignupAttribution({
    source: 'direct_default',
    defaultAgency: { id: 130, joinCode: 'avicx' }
  }), {
    agencyId: 130,
    signupSource: 'direct_default',
    signupAgencyId: 130,
    signupJoinCode: ''
  });
});

test('createSignupAttribution records admin-created franchises separately', () => {
  assert.deepEqual(createSignupAttribution({
    source: 'admin_create',
    agency: { id: 211, joinCode: 'JOIN-211' }
  }), {
    agencyId: 211,
    signupSource: 'admin_create',
    signupAgencyId: 211,
    signupJoinCode: ''
  });
});
