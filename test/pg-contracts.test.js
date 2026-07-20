const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildGhPaymentContracts,
  buildRouteupPaymentContract,
  hasBillablePgContract,
  hasRouteupExternalIntegrationKeys,
  maskPgContract,
  maskPgSecret,
  sanitizePgContracts
} = require('../lib/pg-contracts');

test('GH Payments uses recurring TID and key as the default billable contract', () => {
  const contracts = buildGhPaymentContracts({
    manualTid: 'TMN026062',
    manualKey: 'pk_c375-b5b9e6-f5f-a0b4f',
    recurringTid: 'TMN026063',
    recurringKey: 'pk_123b-3b5ea2-d6d-e21a9'
  });

  assert.equal(contracts.length, 2);
  assert.equal(contracts[0].providerName, 'GH Payments');
  assert.equal(contracts[0].credentialType, 'recurring');
  assert.equal(contracts[0].tid, 'TMN026063');
  assert.equal(contracts[0].paymentKey, 'pk_123b-3b5ea2-d6d-e21a9');
  assert.equal(contracts[0].isDefault, true);
  assert.equal(contracts[1].credentialType, 'manual');
  assert.equal(contracts[1].isDefault, false);
  assert.equal(hasBillablePgContract({ pgContracts: contracts }), true);
});

test('Routeup contract requires TID and payment key while MID is managed by provider settings', () => {
  const contract = buildRouteupPaymentContract({
    tid: '4026070013',
    paymentKey: '24114DrlvqI4oILB7EG8ZxV43N0W8MmJq2boWi2ls8EptDHZMYHzrsqI4pVi7ccu',
    contractStartDate: '2026-07-01',
    contractEndDate: '2027-07-01',
    deviceType: '정기',
    apiKey: 'routeup-api-key',
    encryptionKey: 'routeup-encryption-key',
    initializationVector: 'routeup-iv'
  });

  assert.equal(contract.providerName, '위루트');
  assert.equal(contract.mid, '');
  assert.equal(contract.tid, '4026070013');
  assert.equal(contract.paymentKey.startsWith('24114'), true);
  assert.equal(contract.signatureKey, '');
  assert.equal(contract.credentialType, 'routeup');
  assert.equal(contract.metadata.routeupApiKey, 'routeup-api-key');
  assert.equal(contract.metadata.routeupEncryptionKey, 'routeup-encryption-key');
  assert.equal(contract.metadata.initializationVector, 'routeup-iv');
  assert.equal(contract.isDefault, true);
  assert.equal(hasBillablePgContract({ pgContracts: [contract] }), true);
});

test('Routeup external keys are masked separately from the payment key', () => {
  const masked = maskPgContract(buildRouteupPaymentContract({
    tid: '4026070013',
    paymentKey: '24114DrlvqI4oILB7EG8ZxV43N0W8MmJq2boWi2ls8EptDHZMYHzrsqI4pVi7ccu',
    apiKey: 'routeup-api-key',
    encryptionKey: 'routeup-encryption-key',
    initializationVector: 'routeup-iv'
  }));

  assert.equal(masked.paymentKey, '');
  assert.equal(masked.routeupApiKey, '');
  assert.equal(masked.routeupApiKeyMasked, 'routeup...-key');
  assert.equal(masked.metadata.routeupApiKeyMasked, 'routeup...-key');
  assert.equal(masked.hasRouteupApiKey, true);
});

test('Routeup external integration keys are stored even before TID is issued', () => {
  const contract = buildRouteupPaymentContract({
    apiKey: 'routeup-api-key',
    encryptionKey: 'routeup-encryption-key',
    initializationVector: 'routeup-iv'
  });
  const rows = sanitizePgContracts([contract]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].tid, '');
  assert.equal(rows[0].metadata.routeupApiKey, 'routeup-api-key');
  assert.equal(rows[0].metadata.routeupEncryptionKey, 'routeup-encryption-key');
  assert.equal(rows[0].metadata.initializationVector, 'routeup-iv');
  assert.equal(hasBillablePgContract({ pgContracts: rows }), false);
});

test('Routeup external integration keys approve account status only when all three fields exist', () => {
  const partial = buildRouteupPaymentContract({
    apiKey: 'routeup-api-key',
    encryptionKey: 'routeup-encryption-key'
  });
  const complete = buildRouteupPaymentContract({
    apiKey: 'routeup-api-key',
    encryptionKey: 'routeup-encryption-key',
    initializationVector: 'routeup-iv'
  });

  assert.equal(hasRouteupExternalIntegrationKeys({ pgContracts: [partial] }), false);
  assert.equal(hasRouteupExternalIntegrationKeys({ pgContracts: [complete] }), true);
});

test('Routeup masked external keys are enough for admin approval display', () => {
  assert.equal(hasRouteupExternalIntegrationKeys({
    pgContracts: [{
      providerName: '위루트',
      credentialType: 'routeup',
      routeupApiKeyMasked: '17485ZL...I5w4',
      routeupEncryptionKeyMasked: '17485a...Q9qJ',
      initializationVectorMasked: '17485g...4IVH'
    }]
  }), true);
});

test('PG secret masking keeps enough information for admin identification', () => {
  assert.equal(maskPgSecret('pk_123b-3b5ea2-d6d-e21a9'), 'pk_123b...21a9');
  assert.equal(maskPgSecret('short'), '*hort');
});
