function isProtectedAgencyJoinCode(agency) {
  if (!agency) return false;
  const type = String(agency.type || '').toUpperCase();
  const level = Number(agency.level || 0);
  return type === 'HQ' || (level === 1 && !agency.parentId);
}

module.exports = {
  isProtectedAgencyJoinCode
};
