const fs = require('fs');
const path = require('path');
const { createPool } = require('../db/pool');

const projectRoot = path.join(__dirname, '..');
const logoDir = path.join(projectRoot, 'assets', 'delivery-agencies');
const manifestPath = path.join(logoDir, 'logo_manifest.csv');

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === ',' && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }

  cells.push(current);
  return cells;
}

function manifestBasename(value) {
  return String(value || '').trim().split(/[\\/]/).filter(Boolean).pop() || '';
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`logo manifest not found: ${manifestPath}`);
  }

  const lines = fs.readFileSync(manifestPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines.shift()).map(value => value.trim());
  const agencyIndex = headers.indexOf('agency');
  const fileIndex = headers.indexOf('file');

  if (agencyIndex < 0 || fileIndex < 0) {
    throw new Error('logo_manifest.csv must include agency and file columns');
  }

  return lines
    .map(parseCsvLine)
    .map(cols => {
      const agency = String(cols[agencyIndex] || '').trim();
      const filename = manifestBasename(cols[fileIndex]);
      return { agency, filename };
    })
    .filter(item => item.agency && item.filename && fs.existsSync(path.join(logoDir, item.filename)));
}

async function main() {
  const logos = readManifest();
  const pool = createPool();
  const missing = [];
  let updated = 0;

  try {
    for (const item of logos) {
      const logoUrl = `/assets/delivery-agencies/${encodeURIComponent(item.filename)}`;
      const result = await pool.query(
        `UPDATE delivery_agencies
         SET logo_url = $2,
             updated_at = now()
         WHERE name = $1
           AND status <> 'deleted'
         RETURNING id`,
        [item.agency, logoUrl]
      );

      if (result.rowCount > 0) {
        updated += result.rowCount;
      } else {
        missing.push(item.agency);
      }
    }
  } finally {
    await pool.end();
  }

  console.log(`delivery agency logos scanned=${logos.length} updated=${updated} missing=${missing.length}`);
  if (missing.length) {
    console.log(`missing agencies: ${missing.join(', ')}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
