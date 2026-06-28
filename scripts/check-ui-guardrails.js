const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const adminHtml = fs.readdirSync(root).find(file => /관리자.*\.html$/.test(file));
const baselinePath = path.join(__dirname, 'ui-guardrails-baseline.json');
const baselines = fs.existsSync(baselinePath)
  ? JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  : {};
const targets = [
  adminHtml,
  'index.html',
  'www/index.html',
  'js/app.js',
  'www/js/app.js',
  'css/style.css',
  'www/css/style.css'
].filter(Boolean);

function fullPath(file) {
  return path.join(root, file);
}

function read(file) {
  return fs.readFileSync(fullPath(file), 'utf8');
}

function count(pattern, text) {
  return (text.match(pattern) || []).length;
}

function linesWith(pattern, text) {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(item => pattern.test(item.line));
}

const report = [];

for (const file of targets) {
  if (!fs.existsSync(fullPath(file))) continue;
  const text = read(file);
  report.push({
    file,
    inlineStyle: count(/\sstyle=/g, text),
    inlineOnclick: count(/\sonclick=/g, text),
    inlineOnchange: count(/\sonchange=/g, text),
    inlineEvents: count(/\son(?:click|change|input|keydown|submit|focus|blur)=/g, text),
    btnClass: count(/class=["'][^"']*\bbtn\b/g, text),
    badgeClass: count(/class=["'][^"']*\bbdg\b/g, text),
    dataAction: count(/\sdata-[a-z0-9-]+=/gi, text),
    commonAdminClass: count(/\b(?:admin|payment|settle|settlement|franchise)-[a-z0-9-]+\b/g, text)
  });
}

const duplicateIds = [];
for (const file of targets) {
  if (!fs.existsSync(fullPath(file))) continue;
  const text = read(file);
  const ids = new Map();
  const idMatches = text.matchAll(/\sid=["']([^"']+)["']/g);
  for (const match of idMatches) {
    ids.set(match[1], (ids.get(match[1]) || 0) + 1);
  }
  for (const [id, total] of ids.entries()) {
    if (total > 1) duplicateIds.push({ file, id, total });
  }
}

console.log('\nEats Pay UI guardrails report');
console.log('================================');
for (const row of report) {
  console.log(`\n${row.file}`);
  console.log(`  inline style     : ${row.inlineStyle}`);
  console.log(`  inline onclick   : ${row.inlineOnclick}`);
  console.log(`  inline onchange  : ${row.inlineOnchange}`);
  console.log(`  inline events    : ${row.inlineEvents}`);
  console.log(`  .btn usage       : ${row.btnClass}`);
  console.log(`  .bdg usage       : ${row.badgeClass}`);
  console.log(`  data-* actions   : ${row.dataAction}`);
  console.log(`  admin common cls : ${row.commonAdminClass}`);
}

if (duplicateIds.length) {
  console.log('\nDuplicate static ids');
  duplicateIds.slice(0, 20).forEach(item => {
    console.log(`  ${item.file}: #${item.id} x ${item.total}`);
  });
  if (duplicateIds.length > 20) {
    console.log(`  ...and ${duplicateIds.length - 20} more`);
  }
}

if (adminHtml && fs.existsSync(fullPath(adminHtml))) {
  const admin = read(adminHtml);
  const hotspots = linesWith(/\sstyle=|\sonclick=/g, admin).slice(0, 12);
  console.log('\nFirst admin inline hotspots');
  hotspots.forEach(item => {
    console.log(`  ${adminHtml}:${item.number} ${item.line.trim().slice(0, 140)}`);
  });
}

console.log('\nGuideline');
console.log('  Do not increase inline style/onclick counts unless there is a documented exception.');
console.log('  Prefer common classes and data-* delegated events for new UI.');

const budgetViolations = [];
for (const row of report) {
  const baseline = baselines[row.file];
  if (!baseline) continue;
  for (const key of ['inlineStyle', 'inlineOnclick', 'inlineOnchange', 'inlineEvents']) {
    if (Number(row[key] || 0) > Number(baseline[key] || 0)) {
      budgetViolations.push({ file: row.file, key, current: row[key], limit: baseline[key] });
    }
  }
}

if (budgetViolations.length) {
  console.log('\nInline guardrail violations');
  budgetViolations.forEach(item => {
    console.log(`  ${item.file}: ${item.key} ${item.current} > ${item.limit}`);
  });
  process.exitCode = 1;
}