const SENSITIVE_FIELD_RE = /(password|passwordHash|token|secret|authorization|cookie)/i;

function sanitizeAuditData(value) {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeAuditData(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_FIELD_RE.test(key) ? '[REDACTED]' : sanitizeAuditData(item)
      ])
    );
  }
  return value;
}

function stableStringify(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function valuesEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function uniqueFields(beforeData, afterData, fields) {
  if (Array.isArray(fields) && fields.length) {
    return fields.map(String);
  }
  return [
    ...Object.keys(beforeData || {}),
    ...Object.keys(afterData || {})
  ].filter((field, index, all) => all.indexOf(field) === index);
}

function buildAuditChangeSet(beforeData = {}, afterData = {}, options = {}) {
  const beforeSource = beforeData || {};
  const afterSource = afterData || {};
  const fields = uniqueFields(beforeSource, afterSource, options.fields);
  const before = {};
  const after = {};
  const changedFields = [];

  for (const field of fields) {
    const beforeValue = beforeSource[field];
    const afterValue = afterSource[field];
    if (valuesEqual(beforeValue, afterValue)) continue;
    changedFields.push(field);
    before[field] = beforeValue;
    after[field] = afterValue;
  }

  return {
    beforeData: sanitizeAuditData(before),
    afterData: sanitizeAuditData(after),
    changedFields
  };
}

module.exports = {
  buildAuditChangeSet,
  sanitizeAuditData
};
