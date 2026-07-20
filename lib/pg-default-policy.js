'use strict';

const { normalizeProviderName } = require('./pg-contracts');

function isHeadOfficeAgency(agency = {}) {
  const type = String(agency.type || agency.agencyType || '').trim().toUpperCase();
  const name = String(agency.name || agency.agencyName || '').trim();
  const joinCode = String(agency.joinCode || agency.join_code || '').trim().toUpperCase();
  if (type === 'BRANCH' || type === 'OFFICE') return false;
  return type === 'HQ' || joinCode === 'EATSPAY-HQ' || name.includes('본사');
}

function selectDefaultPgProvider(providers = [], agency = null) {
  const activeProviders = (Array.isArray(providers) ? providers : [])
    .filter(provider => provider && provider.status === '활성');
  const preferredName = isHeadOfficeAgency(agency || {}) ? '위루트' : 'GH Payments';
  const preferred = activeProviders.find(provider => normalizeProviderName(provider.name) === preferredName);
  if (preferred) return preferred;
  return activeProviders
    .slice()
    .sort((a, b) => (Number(a.displayOrder || 0) - Number(b.displayOrder || 0))
      || String(a.name || '').localeCompare(String(b.name || '')))[0] || null;
}

module.exports = {
  isHeadOfficeAgency,
  selectDefaultPgProvider
};
