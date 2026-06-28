'use strict';

function createPublicAgencyInvite(agency) {
  if (!agency) return null;
  const joinCode = String(agency.joinCode || agency.join_code || '').trim();
  const agencyId = agency.id == null ? '' : String(agency.id).trim();
  const agencyName = String(agency.name || '').trim();
  if (!joinCode || !agencyId || !agencyName) return null;
  return {
    agencyId,
    agencyName,
    joinCode
  };
}

module.exports = {
  createPublicAgencyInvite
};
