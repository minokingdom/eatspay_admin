function createSignupAttribution({ source, agency = null, defaultAgency = null } = {}) {
  const selectedAgency = agency || defaultAgency || null;
  const signupSource = source || (agency ? 'agency_link' : 'direct_default');
  return {
    agencyId: selectedAgency?.id || null,
    signupSource,
    signupAgencyId: selectedAgency?.id || null,
    signupJoinCode: signupSource === 'agency_link' ? String(selectedAgency?.joinCode || '') : ''
  };
}

module.exports = {
  createSignupAttribution
};
