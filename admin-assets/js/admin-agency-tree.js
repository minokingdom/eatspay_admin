(function () {
  const root = window.EatsAdminAgencyTree || {};
  const TYPE_META = {
    hq: { label: '본사', prefix: '[본사]', rank: 0, level: 1 },
    bonbu: { label: '본부', prefix: '[본부]', rank: 1, level: 2 },
    jisa: { label: '지사', prefix: '[지사]', rank: 2, level: 3 },
    jijum: { label: '지점', prefix: '[지점]', rank: 3, level: 4 }
  };

  function typeKey(agencyOrType) {
    const source = typeof agencyOrType === 'string' ? { type: agencyOrType } : (agencyOrType || {});
    const raw = String(source.type || '').toLowerCase();
    if (raw === 'hq' || raw === 'head' || raw === 'headquarters' || raw === '본사') return 'hq';
    if (raw === 'bonbu' || raw === 'division' || raw === '본부') return 'bonbu';
    if (raw === 'branch' || raw === 'jisa' || raw === '지사') return 'jisa';
    if (raw === 'office' || raw === 'agency' || raw === 'jijum' || raw === '지점') return Number(source.level || 0) >= 3 ? 'jijum' : 'jisa';
    const level = Number(source.level || 0);
    if (level <= 1) return 'hq';
    if (level === 2) return 'bonbu';
    if (level === 3) return 'jisa';
    return 'jijum';
  }

  function typeMeta(agencyOrType) {
    const directKey = typeof agencyOrType === 'string' ? agencyOrType : '';
    const key = TYPE_META[directKey] ? directKey : typeKey(agencyOrType);
    return TYPE_META[key] || null;
  }

  function typeRank(agency) {
    return typeMeta(agency)?.rank ?? 9;
  }

  function typeLabel(agency) {
    return typeMeta(agency)?.label || `${agency?.level || '-'}단계`;
  }

  function typePrefix(agency) {
    return typeMeta(agency)?.prefix || `[${agency?.level || '-'}단계]`;
  }

  function visualDepth(agency, fallbackDepth) {
    const key = typeKey(agency);
    if (key === 'hq') return 0;
    if (key === 'bonbu') return 1;
    if (key === 'jisa') return 2;
    if (key === 'jijum') return 3;
    return Math.min(Math.max(Number(fallbackDepth) || 0, 0), 3);
  }

  window.EatsAdminAgencyTree = Object.assign(root, {
    version: '2026-06-26.agency-tree.1',
    TYPE_META,
    typeKey,
    typeMeta,
    typeRank,
    typeLabel,
    typePrefix,
    visualDepth
  });
})();
