'use strict';

function clean(value) {
  return String(value || '').trim();
}

function normalizeProviderName(value = '') {
  const raw = clean(value);
  const compact = raw.replace(/\s+/g, '').toLowerCase();
  if (['ghpayments', 'ghpayment', 'gh', '건흥', '건흥페이먼츠'].includes(compact)) return 'GH Payments';
  if (['routeup', 'route', '루트업'].includes(compact)) return '루트업';
  return raw;
}

function maskPgSecret(value = '') {
  const raw = clean(value);
  if (!raw) return '';
  if (raw.length <= 4) return '*'.repeat(raw.length);
  if (raw.length <= 10) return raw.replace(/.(?=.{4})/g, '*');
  return `${raw.slice(0, 7)}...${raw.slice(-4)}`;
}

function normalizeContractDate(value = '') {
  const raw = clean(value);
  if (!raw) return '';
  const match = raw.match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : raw;
}

function normalizePgContract(contract = {}) {
  const providerName = normalizeProviderName(contract.providerName || contract.pgProviderName || contract.provider || '');
  const credentialType = clean(contract.credentialType || contract.type || contract.usage || (providerName === '루트업' ? 'routeup' : 'recurring')) || 'recurring';
  const metadata = contract.metadata && typeof contract.metadata === 'object' ? { ...contract.metadata } : {};
  const routeupApiKey = clean(contract.routeupApiKey || contract.apiKey || metadata.routeupApiKey || metadata.apiKey);
  const routeupEncryptionKey = clean(contract.routeupEncryptionKey || contract.encryptionKey || contract.encryptKey || metadata.routeupEncryptionKey || metadata.encryptionKey || metadata.encryptKey);
  const initializationVector = clean(contract.initializationVector || contract.iv || metadata.initializationVector || metadata.iv);
  if (routeupApiKey) metadata.routeupApiKey = routeupApiKey;
  if (routeupEncryptionKey) metadata.routeupEncryptionKey = routeupEncryptionKey;
  if (initializationVector) metadata.initializationVector = initializationVector;
  return {
    id: contract.id || null,
    providerId: contract.providerId || contract.pgProviderId || null,
    providerName,
    credentialType,
    mid: clean(contract.mid),
    tid: clean(contract.tid || contract.txid),
    paymentKey: clean(contract.paymentKey || contract.payKey || contract.key || (providerName === '루트업' ? '' : contract.apiKey)),
    signatureKey: clean(contract.signatureKey || contract.signKey || contract.sign_key),
    contractStartDate: normalizeContractDate(contract.contractStartDate || contract.startDate || contract.contract_start_date),
    contractEndDate: normalizeContractDate(contract.contractEndDate || contract.endDate || contract.contract_end_date),
    deviceType: clean(contract.deviceType || contract.device_type || contract.terminalType),
    isDefault: contract.isDefault !== false,
    active: contract.active !== false,
    metadata
  };
}

function buildGhPaymentContracts(input = {}) {
  const recurringTid = clean(input.recurringTid || input.recurring_tid || input.txid);
  const recurringKey = clean(input.recurringKey || input.recurring_key);
  const manualTid = clean(input.manualTid || input.manual_tid);
  const manualKey = clean(input.manualKey || input.manual_key);
  const contracts = [];
  if (recurringTid || recurringKey) {
    contracts.push(normalizePgContract({
      providerId: input.providerId || input.pgProviderId || null,
      providerName: 'GH Payments',
      credentialType: 'recurring',
      tid: recurringTid,
      paymentKey: recurringKey,
      isDefault: true
    }));
  }
  if (manualTid || manualKey) {
    contracts.push(normalizePgContract({
      providerId: input.providerId || input.pgProviderId || null,
      providerName: 'GH Payments',
      credentialType: 'manual',
      tid: manualTid,
      paymentKey: manualKey,
      isDefault: false
    }));
  }
  return contracts;
}

function buildRouteupPaymentContract(input = {}) {
  const metadata = {
    ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {})
  };
  const routeupApiKey = clean(input.routeupApiKey || input.apiKey || metadata.routeupApiKey || metadata.apiKey);
  const routeupEncryptionKey = clean(input.routeupEncryptionKey || input.encryptionKey || input.encryptKey || metadata.routeupEncryptionKey || metadata.encryptionKey || metadata.encryptKey);
  const initializationVector = clean(input.initializationVector || input.iv || metadata.initializationVector || metadata.iv);
  if (routeupApiKey) metadata.routeupApiKey = routeupApiKey;
  if (routeupEncryptionKey) metadata.routeupEncryptionKey = routeupEncryptionKey;
  if (initializationVector) metadata.initializationVector = initializationVector;
  return normalizePgContract({
    providerId: input.providerId || input.pgProviderId || null,
    providerName: '루트업',
    credentialType: 'routeup',
    mid: input.mid,
    tid: input.tid || input.txid,
    paymentKey: input.paymentKey || input.payKey || input.key,
    signatureKey: input.signatureKey || input.signKey,
    contractStartDate: input.contractStartDate || input.startDate,
    contractEndDate: input.contractEndDate || input.endDate,
    deviceType: input.deviceType || input.terminalType,
    isDefault: input.isDefault !== false,
    metadata
  });
}

function sanitizePgContracts(contracts = []) {
  return (Array.isArray(contracts) ? contracts : [])
    .map(normalizePgContract)
    .filter(contract => isStorablePgContract(contract));
}

function hasRouteupExternalKeys(contract = {}) {
  const normalized = normalizePgContract(contract);
  const metadata = normalized.metadata && typeof normalized.metadata === 'object' ? normalized.metadata : {};
  return normalizeProviderName(normalized.providerName) === '루트업' && Boolean(
    clean(metadata.routeupApiKey || metadata.apiKey || contract.routeupApiKey || contract.apiKey) ||
    clean(metadata.routeupEncryptionKey || metadata.encryptionKey || metadata.encryptKey || contract.routeupEncryptionKey || contract.encryptionKey || contract.encryptKey) ||
    clean(metadata.initializationVector || metadata.iv || contract.initializationVector || contract.iv)
  );
}

function hasCompleteRouteupExternalKeys(contract = {}) {
  const normalized = normalizePgContract(contract);
  const metadata = normalized.metadata && typeof normalized.metadata === 'object' ? normalized.metadata : {};
  if (normalizeProviderName(normalized.providerName) !== '루트업') return false;
  const apiKey = clean(
    metadata.routeupApiKey ||
    metadata.apiKey ||
    metadata.routeupApiKeyMasked ||
    metadata.apiKeyMasked ||
    contract.routeupApiKey ||
    contract.apiKey ||
    contract.routeupApiKeyMasked ||
    contract.apiKeyMasked
  );
  const encryptionKey = clean(
    metadata.routeupEncryptionKey ||
    metadata.encryptionKey ||
    metadata.encryptKey ||
    metadata.routeupEncryptionKeyMasked ||
    metadata.encryptionKeyMasked ||
    metadata.encryptKeyMasked ||
    contract.routeupEncryptionKey ||
    contract.encryptionKey ||
    contract.encryptKey ||
    contract.routeupEncryptionKeyMasked ||
    contract.encryptionKeyMasked ||
    contract.encryptKeyMasked
  );
  const initializationVector = clean(
    metadata.initializationVector ||
    metadata.iv ||
    metadata.initializationVectorMasked ||
    metadata.ivMasked ||
    contract.initializationVector ||
    contract.iv ||
    contract.initializationVectorMasked ||
    contract.ivMasked
  );
  return Boolean(
    (apiKey || contract.hasRouteupApiKey || metadata.hasRouteupApiKey) &&
    (encryptionKey || contract.hasRouteupEncryptionKey || metadata.hasRouteupEncryptionKey) &&
    (initializationVector || contract.hasInitializationVector || metadata.hasInitializationVector)
  );
}

function hasRouteupExternalIntegrationKeys(account = {}) {
  const contracts = Array.isArray(account.pgContracts || account.pg_contracts)
    ? (account.pgContracts || account.pg_contracts)
    : [];
  if (contracts.some(hasCompleteRouteupExternalKeys)) return true;
  const providerName = normalizeProviderName(account.providerName || account.pgProviderName || account.pg_provider_name || '');
  return providerName === '루트업' && hasCompleteRouteupExternalKeys({ ...account, providerName: '루트업' });
}

function isStorablePgContract(contract = {}) {
  const normalized = normalizePgContract(contract);
  if (!normalized.active || !normalized.providerName) return false;
  if (normalized.tid) return true;
  return hasRouteupExternalKeys(contract);
}

function maskPgContract(contract = {}) {
  const normalized = normalizePgContract(contract);
  const metadata = normalized.metadata && typeof normalized.metadata === 'object' ? { ...normalized.metadata } : {};
  const routeupApiKey = clean(metadata.routeupApiKey || metadata.apiKey || contract.routeupApiKey || contract.apiKey);
  const routeupEncryptionKey = clean(metadata.routeupEncryptionKey || metadata.encryptionKey || metadata.encryptKey || contract.routeupEncryptionKey || contract.encryptionKey || contract.encryptKey);
  const initializationVector = clean(metadata.initializationVector || metadata.iv || contract.initializationVector || contract.iv);
  delete metadata.routeupApiKey;
  delete metadata.apiKey;
  delete metadata.routeupEncryptionKey;
  delete metadata.encryptionKey;
  delete metadata.encryptKey;
  delete metadata.initializationVector;
  delete metadata.iv;
  if (routeupApiKey) metadata.routeupApiKeyMasked = maskPgSecret(routeupApiKey);
  if (routeupEncryptionKey) metadata.routeupEncryptionKeyMasked = maskPgSecret(routeupEncryptionKey);
  if (initializationVector) metadata.initializationVectorMasked = maskPgSecret(initializationVector);
  return {
    ...normalized,
    paymentKey: '',
    signatureKey: '',
    metadata,
    paymentKeyMasked: maskPgSecret(normalized.paymentKey),
    signatureKeyMasked: maskPgSecret(normalized.signatureKey),
    hasPaymentKey: Boolean(normalized.paymentKey),
    hasSignatureKey: Boolean(normalized.signatureKey),
    routeupApiKey: '',
    routeupEncryptionKey: '',
    initializationVector: '',
    routeupApiKeyMasked: maskPgSecret(routeupApiKey),
    routeupEncryptionKeyMasked: maskPgSecret(routeupEncryptionKey),
    initializationVectorMasked: maskPgSecret(initializationVector),
    hasRouteupApiKey: Boolean(routeupApiKey),
    hasRouteupEncryptionKey: Boolean(routeupEncryptionKey),
    hasInitializationVector: Boolean(initializationVector)
  };
}

function hasBillablePgContract(account = {}) {
  const contracts = sanitizePgContracts(account.pgContracts || account.pg_contracts || []);
  if (contracts.some(contract => {
    if (normalizeProviderName(contract.providerName) === '루트업') {
      return contract.isDefault !== false && Boolean(contract.tid && contract.paymentKey);
    }
    if (normalizeProviderName(contract.providerName) === 'GH Payments') {
      return contract.credentialType === 'recurring' && Boolean(contract.tid && contract.paymentKey);
    }
    return contract.isDefault !== false && Boolean(contract.tid && contract.paymentKey);
  })) {
    return true;
  }
  const recurringTid = clean(account.recurringTid || account.recurring_tid || account.txid);
  const recurringKey = clean(account.recurringKey || account.recurring_key);
  return Boolean(recurringTid && recurringKey);
}

module.exports = {
  buildGhPaymentContracts,
  buildRouteupPaymentContract,
  hasBillablePgContract,
  hasCompleteRouteupExternalKeys,
  hasRouteupExternalIntegrationKeys,
  maskPgContract,
  maskPgSecret,
  normalizePgContract,
  normalizeProviderName,
  sanitizePgContracts
};
