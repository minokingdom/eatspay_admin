const fs = require('fs');
const path = require('path');

const { createPool } = require('../db/pool');
const { createRepository } = require('../db/repository');
const { parseCardGorillaRanking } = require('../lib/cardgorilla');

const DEFAULT_HEADERS = {
  accept: 'application/json, text/plain, */*',
  referer: 'https://www.card-gorilla.com/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

async function fetchJson(url) {
  const response = await fetch(url, { headers: DEFAULT_HEADERS });
  if (!response.ok) {
    throw new Error(`CARDGORILLA_FETCH_FAILED ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    const contentType = response.headers.get('content-type') || '';
    throw new Error(`CARDGORILLA_NON_JSON_RESPONSE ${contentType} ${text.slice(0, 80)}`);
  }
}

function readLocalPayload(filePath) {
  const absolutePath = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

async function loadCardGorillaPayload() {
  const localFile = process.argv.find(arg => arg.startsWith('--file='))?.slice('--file='.length);
  if (localFile) return readLocalPayload(localFile);

  const url = String(process.env.CARDGORILLA_RANKING_URL || '').trim();
  if (!url) {
    const fallback = path.join(__dirname, '..', 'cardgorilla-ranking-response.json');
    if (fs.existsSync(fallback)) return readLocalPayload(fallback);
    throw new Error('CARDGORILLA_RANKING_URL is required when no local fallback exists.');
  }
  return fetchJson(url);
}

async function main() {
  const payload = await loadCardGorillaPayload();
  const cards = parseCardGorillaRanking(payload);
  if (!cards.length) {
    throw new Error('CARDGORILLA_EMPTY_RESULT');
  }

  const pool = createPool();
  try {
    const repo = createRepository(pool);
    const result = await repo.upsertBenefitCardsFromCardGorilla(cards);
    console.log(`[cardgorilla] imported=${result.imported} first="${cards[0].cardCompany} ${cards[0].cardName}"`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[cardgorilla] update failed:', err.message);
  process.exit(1);
});
